import { useEffect, useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080'

const STATE_LABELS = {
  R: 'Running',
  S: 'Sleeping',
  D: 'Waiting',
  Z: 'Zombie',
  T: 'Stopped',
  I: 'Idle'
}

const CPU_ALERT = 20
const MEM_ALERT = 10
const LOG_LIMIT = 5

const formatKb = (kb) => {
  if (kb == null) return '—'
  if (kb < 1024) return `${kb} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

const formatPercent = (value) => {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)}%`
}

const toCsvValue = (value) => {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export default function App() {
  const [processes, setProcesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [userOnly, setUserOnly] = useState(true)
  const [currentUser, setCurrentUser] = useState('')
  const [sortKey, setSortKey] = useState('pid')
  const [sortDir, setSortDir] = useState('asc')
  const [selected, setSelected] = useState(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [actionLog, setActionLog] = useState([])

  const loadProcesses = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/processes`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to fetch processes')
      setProcesses(data.processes || [])
      setCurrentUser(data.current_user || '')
    } catch (err) {
      setError(err.message || 'Unexpected error')
    } finally {
      setLoading(false)
    }
  }

  const pushLog = (entry) => {
    setActionLog((prev) => [entry, ...prev].slice(0, LOG_LIMIT))
  }

  const updateLog = (id, patch) => {
    setActionLog((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const killProcess = async (pid, name, owner) => {
    const isOwn = !currentUser || (owner || '').toLowerCase() === currentUser.toLowerCase()
    if (!isOwn) {
      setError('Permission denied. You can only terminate your own processes.')
      return
    }

    const ok = window.confirm(`Terminate ${name} (PID ${pid})?`)
    if (!ok) return

    const logId = Date.now()
    pushLog({
      id: logId,
      pid,
      name,
      status: 'pending',
      message: 'Sending SIGTERM...',
      time: new Date().toLocaleTimeString()
    })

    try {
      const res = await fetch(`${API_BASE}/api/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid })
      })
      const data = await res.json()
      const detail = data?.message
        ? `${data.error}: ${data.message} (errno ${data.errno})`
        : data?.error
      if (!res.ok) throw new Error(detail || 'Failed to terminate')

      updateLog(logId, { status: 'success', message: 'Terminated successfully' })
      await loadProcesses()
    } catch (err) {
      const msg = err.message || 'Failed to terminate'
      updateLog(logId, { status: 'error', message: msg })
      setError(msg)
    }
  }

  const exportCsv = () => {
    const header = [
      'pid',
      'name',
      'user',
      'state',
      'cpu_percent',
      'mem_percent',
      'rss_kb',
      'vmsize_kb'
    ]
    const rows = sorted.map((p) => [
      p.pid,
      p.name,
      p.user,
      STATE_LABELS[p.state] || p.state,
      p.cpu_percent?.toFixed(2),
      p.mem_percent?.toFixed(2),
      p.vmrss_kb,
      p.vmsize_kb
    ])
    const csv = [header, ...rows]
      .map((row) => row.map(toCsvValue).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'processes.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  useEffect(() => {
    loadProcesses()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(loadProcesses, 3000)
    return () => clearInterval(id)
  }, [autoRefresh])

  useEffect(() => {
    setPage(1)
  }, [filter, userOnly, currentUser, sortKey, sortDir, pageSize])

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase()
    let list = processes

    if (userOnly && currentUser) {
      list = list.filter((p) => (p.user || '').toLowerCase() === currentUser.toLowerCase())
    }

    if (!term) return list
    return list.filter((p) => {
      return (
        String(p.pid).includes(term) ||
        p.name.toLowerCase().includes(term) ||
        (STATE_LABELS[p.state] || p.state).toLowerCase().includes(term)
      )
    })
  }, [processes, filter, userOnly, currentUser])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      if (sortKey === 'pid') return (a.pid - b.pid) * dir
      if (sortKey === 'cpu') return ((a.cpu_percent || 0) - (b.cpu_percent || 0)) * dir
      if (sortKey === 'mem') return ((a.mem_percent || 0) - (b.mem_percent || 0)) * dir
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir
      return 0
    })
    return list
  }, [filtered, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, page, pageSize])

  const userCount = useMemo(() => {
    if (!currentUser) return 0
    return processes.filter((p) => (p.user || '').toLowerCase() === currentUser.toLowerCase())
      .length
  }, [processes, currentUser])

  const highUsageCount = useMemo(() => {
    return processes.filter(
      (p) => (p.cpu_percent || 0) >= CPU_ALERT || (p.mem_percent || 0) >= MEM_ALERT
    ).length
  }, [processes])

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">Process Management</p>
        <h1>Task Manager Clone</h1>
        <p className="subtitle">
          Learn how the OS monitors, lists, and terminates running processes.
        </p>
      </header>

      <section className="summary">
        <div className="summary-card">
          <span>Total Processes</span>
          <strong>{processes.length}</strong>
        </div>
        <div className="summary-card">
          <span>User Processes</span>
          <strong>{userCount}</strong>
        </div>
        <div className="summary-card">
          <span>High Usage</span>
          <strong>{highUsageCount}</strong>
          <em>CPU ≥ {CPU_ALERT}% or Mem ≥ {MEM_ALERT}%</em>
        </div>
      </section>

      <section className="panel">
        <div className="controls">
          <input
            type="text"
            placeholder="Search by PID, name, or state"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="ghost" onClick={loadProcesses}>
            Refresh
          </button>
          <button onClick={exportCsv}>Export CSV</button>
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto refresh</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={userOnly}
              onChange={(e) => setUserOnly(e.target.checked)}
            />
            <span>User only {currentUser ? `(${currentUser})` : ''}</span>
          </label>
        </div>
        <div className="status">
          {loading
            ? 'Loading...'
            : sorted.length
              ? `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, sorted.length)} of ${sorted.length}`
              : '0 processes shown'}
          {error ? <span className="error">{error}</span> : null}
        </div>
      </section>

      <section className="sorts">
        <span>Sort by:</span>
        <button
          className={sortKey === 'pid' ? 'active' : ''}
          onClick={() => toggleSort('pid')}
        >
          PID {sortKey === 'pid' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
        </button>
        <button
          className={sortKey === 'name' ? 'active' : ''}
          onClick={() => toggleSort('name')}
        >
          Name {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
        </button>
        <button
          className={sortKey === 'cpu' ? 'active' : ''}
          onClick={() => toggleSort('cpu')}
        >
          CPU% {sortKey === 'cpu' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
        </button>
        <button
          className={sortKey === 'mem' ? 'active' : ''}
          onClick={() => toggleSort('mem')}
        >
          Mem% {sortKey === 'mem' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
        </button>
      </section>

      <section className="pagination">
        <div className="pager">
          <button className="ghost" onClick={() => setPage(1)} disabled={page === 1}>
            First
          </button>
          <button
            className="ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            className="ghost"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next
          </button>
          <button
            className="ghost"
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages}
          >
            Last
          </button>
        </div>
        <div className="page-size">
          <label htmlFor="pageSize">Rows</label>
          <select
            id="pageSize"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            <option value="10">10</option>
            <option value="15">15</option>
            <option value="20">20</option>
            <option value="50">50</option>
          </select>
        </div>
      </section>

      <section className="action-log">
        <h3>Terminate Requests</h3>
        {actionLog.length ? (
          <ul>
            {actionLog.map((item) => (
              <li key={item.id} className={`log-item ${item.status}`}>
                <span>
                  {item.time} — PID {item.pid} ({item.name})
                </span>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No terminate requests yet.</p>
        )}
      </section>

      <section className="table">
        <div className="table-head">
          <span>PID</span>
          <span>Process</span>
          <span>User</span>
          <span>State</span>
          <span>CPU %</span>
          <span>Mem %</span>
          <span>RSS</span>
          <span>Action</span>
        </div>
        <div className="table-body">
          {paged.map((p) => {
            const high = (p.cpu_percent || 0) >= CPU_ALERT || (p.mem_percent || 0) >= MEM_ALERT
            const isOwn = !currentUser || (p.user || '').toLowerCase() === currentUser.toLowerCase()
            return (
              <div className={`row ${high ? 'alert' : ''}`} key={`${p.pid}-${p.name}`}>
                <span className="pid" data-label="PID">{p.pid}</span>
                <span data-label="Process">{p.name}</span>
                <span data-label="User">{p.user || '—'}</span>
                <span data-label="State">{STATE_LABELS[p.state] || p.state}</span>
                <span data-label="CPU %">{formatPercent(p.cpu_percent)}</span>
                <span data-label="Mem %">{formatPercent(p.mem_percent)}</span>
                <span data-label="RSS">{formatKb(p.vmrss_kb)}</span>
                <span data-label="Action" className="actions">
                  <button className="ghost" onClick={() => setSelected(p)}>
                    Details
                  </button>
                  <button
                    className="danger"
                    disabled={!isOwn}
                    title={!isOwn ? 'Permission denied' : 'Terminate'}
                    onClick={() => killProcess(p.pid, p.name, p.user)}
                  >
                    Terminate
                  </button>
                </span>
              </div>
            )
          })}
          {!sorted.length && !loading ? (
            <div className="empty">No matching processes found.</div>
          ) : null}
        </div>
      </section>

      {selected ? (
        <div className="modal" onClick={() => setSelected(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Process Details</h2>
            <div className="detail-grid">
              <div>
                <span>PID</span>
                <strong>{selected.pid}</strong>
              </div>
              <div>
                <span>Name</span>
                <strong>{selected.name}</strong>
              </div>
              <div>
                <span>User</span>
                <strong>{selected.user || '—'}</strong>
              </div>
              <div>
                <span>State</span>
                <strong>{STATE_LABELS[selected.state] || selected.state}</strong>
              </div>
              <div>
                <span>CPU %</span>
                <strong>{formatPercent(selected.cpu_percent)}</strong>
              </div>
              <div>
                <span>Mem %</span>
                <strong>{formatPercent(selected.mem_percent)}</strong>
              </div>
              <div>
                <span>RSS</span>
                <strong>{formatKb(selected.vmrss_kb)}</strong>
              </div>
              <div>
                <span>VM Size</span>
                <strong>{formatKb(selected.vmsize_kb)}</strong>
              </div>
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setSelected(null)}>
                Close
              </button>
              <button
                className="danger"
                disabled={
                  currentUser && (selected.user || '').toLowerCase() !== currentUser.toLowerCase()
                }
                title={
                  currentUser && (selected.user || '').toLowerCase() !== currentUser.toLowerCase()
                    ? 'Permission denied'
                    : 'Terminate'
                }
                onClick={() => killProcess(selected.pid, selected.name, selected.user)}
              >
                Terminate
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
