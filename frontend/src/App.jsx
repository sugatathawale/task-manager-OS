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

export default function App() {
  const [processes, setProcesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [userOnly, setUserOnly] = useState(true)
  const [currentUser, setCurrentUser] = useState('')

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

  const killProcess = async (pid, name) => {
    const ok = window.confirm(`Terminate ${name} (PID ${pid})?`)
    if (!ok) return

    try {
      const res = await fetch(`${API_BASE}/api/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to terminate')
      await loadProcesses()
    } catch (err) {
      setError(err.message || 'Failed to terminate')
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

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">Process Management</p>
        <h1>Task Manager Clone</h1>
        <p className="subtitle">
          Learn how the OS monitors, lists, and terminates running processes.
        </p>
      </header>

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
          {loading ? 'Loading...' : `${filtered.length} processes shown`}
          {error ? <span className="error">{error}</span> : null}
        </div>
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
          {filtered.map((p, idx) => (
            <div className="row" key={`${p.pid}-${p.name}`}>
              <span className="pid" data-label="PID">{p.pid}</span>
              <span data-label="Process">{p.name}</span>
              <span data-label="User">{p.user || '—'}</span>
              <span data-label="State">{STATE_LABELS[p.state] || p.state}</span>
              <span data-label="CPU %">{formatPercent(p.cpu_percent)}</span>
              <span data-label="Mem %">{formatPercent(p.mem_percent)}</span>
              <span data-label="RSS">{formatKb(p.vmrss_kb)}</span>
              <span data-label="Action">
                <button className="danger" onClick={() => killProcess(p.pid, p.name)}>
                  Terminate
                </button>
              </span>
            </div>
          ))}
          {!filtered.length && !loading ? (
            <div className="empty">No matching processes found.</div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
