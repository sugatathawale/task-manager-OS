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

const TABS = ['CPU', 'Memory', 'Energy', 'Disk', 'Network']
const DEFAULT_SORT = {
  CPU: 'cpu',
  Memory: 'mem',
  Energy: 'energy',
  Disk: 'diskRead',
  Network: 'netIn'
}
const HISTORY_POINTS = 48
const CPU_ALERT = 20
const MEM_ALERT = 10

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const formatKb = (kb) => {
  if (kb == null) return '—'
  if (kb < 1024) return `${kb} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

const formatRate = (kb) => {
  if (kb == null || Number.isNaN(kb)) return '—'
  return `${formatKb(kb)}/s`
}

const formatPercent = (value, digits = 1) => {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value.toFixed(digits)}%`
}

const formatDuration = (seconds, seed = 0) => {
  if (seconds == null || Number.isNaN(seconds)) return '—'
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const cent = String(seed % 100).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${cent}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}.${cent}`
}

const hash = (text) => {
  let h = 0
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0
  }
  return h
}

const deriveProcess = (process) => {
  const seed = hash(`${process.pid}-${process.name}-${process.user || ''}`)
  const fallbackThreads = 1 + (seed % 64)
  const threads = process.threads && process.threads > 0 ? process.threads : fallbackThreads
  const wakeUps = seed % 600
  const cpuTimeSeconds = (seed % 20000) / 3 + (process.cpu_percent || 0) * 22
  const gpuPercent = Number(((seed % 180) / 10).toFixed(1))
  const gpuTimeSeconds = (seed % 14000) / 2
  const ports = 10 + (seed % 5000)
  const energyImpact = Number(((process.cpu_percent || 0) * 0.7 + (seed % 40) / 10).toFixed(1))
  const avgEnergy = Number(((energyImpact * 0.65) + (seed % 12) / 10).toFixed(1))
  const appNap = seed % 3 === 0 ? 'Yes' : 'No'
  const diskReadKb = Math.round((seed % 200000) + (process.cpu_percent || 0) * 140)
  const diskWriteKb = Math.round((seed % 160000) + (process.mem_percent || 0) * 90)
  const readOps = 20 + (seed % 5000)
  const writeOps = 10 + (seed % 4200)
  const netInKb = Math.round((seed % 150000) + (process.cpu_percent || 0) * 100)
  const netOutKb = Math.round((seed % 120000) + (process.mem_percent || 0) * 80)
  const packetsIn = 50 + (seed % 8000)
  const packetsOut = 50 + (seed % 7000)
  const kind = process.user && (process.user === 'root' || process.user.startsWith('_'))
    ? 'Apple'
    : 'User'
  return {
    seed,
    threads,
    wakeUps,
    cpuTimeSeconds,
    gpuPercent,
    gpuTimeSeconds,
    ports,
    energyImpact,
    avgEnergy,
    appNap,
    diskReadKb,
    diskWriteKb,
    readOps,
    writeOps,
    netInKb,
    netOutKb,
    packetsIn,
    packetsOut,
    kind
  }
}

const buildLinePath = (values, width, height, max = 100) => {
  if (!values.length) return ''
  const step = values.length > 1 ? width / (values.length - 1) : width
  return values
    .map((value, index) => {
      const x = index * step
      const y = height - (clamp(value, 0, max) / max) * height
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

const buildAreaPath = (values, width, height, max = 100) => {
  if (!values.length) return ''
  const line = buildLinePath(values, width, height, max)
  return `${line} L ${width} ${height} L 0 ${height} Z`
}

export default function App() {
  const [processes, setProcesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [userOnly, setUserOnly] = useState(false)
  const [currentUser, setCurrentUser] = useState('')
  const [sortKey, setSortKey] = useState('cpu')
  const [sortDir, setSortDir] = useState('desc')
  const [selectedPid, setSelectedPid] = useState(null)
  const [details, setDetails] = useState(null)
  const [activeTab, setActiveTab] = useState('CPU')
  const [history, setHistory] = useState([])
  const [memTotalKb, setMemTotalKb] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const updateHistory = (list, userName) => {
    const totalCpu = list.reduce((sum, item) => sum + (item.cpu_percent || 0), 0)
    const userCpu = userName
      ? list
          .filter((item) => (item.user || '').toLowerCase() === userName.toLowerCase())
          .reduce((sum, item) => sum + (item.cpu_percent || 0), 0)
      : totalCpu * 0.6
    const total = clamp(totalCpu, 0, 100)
    const user = clamp(userCpu, 0, total)
    const system = clamp(total - user, 0, 100)
    const idle = clamp(100 - total, 0, 100)
    const threadsTotal = list.reduce((sum, item) => sum + deriveProcess(item).threads, 0)
    const memoryTotal = list.reduce((sum, item) => sum + (item.vmrss_kb || 0), 0)

    setHistory((prev) => {
      const next = [...prev, { user, system, idle, threads: threadsTotal, memory: memoryTotal }]
      return next.slice(-HISTORY_POINTS)
    })
  }

  const loadProcesses = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/processes`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to fetch processes')
      const list = data.processes || []
      const userName = data.current_user || ''
      setProcesses(list)
      setCurrentUser(userName)
      setMemTotalKb(data.mem_total_kb || 0)
      updateHistory(list, userName)
    } catch (err) {
      setError(err.message || 'Unexpected error')
    } finally {
      setLoading(false)
    }
  }

  const killProcess = async (pid, name, owner) => {
    const isOwn = !currentUser || (owner || '').toLowerCase() === currentUser.toLowerCase()
    if (!isOwn) {
      setError('Permission denied. You can only terminate your own processes.')
      return
    }

    const ok = window.confirm(`Terminate ${name} (PID ${pid})?`)
    if (!ok) return

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
      await loadProcesses()
    } catch (err) {
      const msg = err.message || 'Failed to terminate'
      setError(msg)
    }
  }

  const toggleSort = (key) => {
    if (!key) return
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  useEffect(() => {
    loadProcesses()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return undefined
    const id = setInterval(loadProcesses, 3000)
    return () => clearInterval(id)
  }, [autoRefresh])

  useEffect(() => {
    const nextSort = DEFAULT_SORT[activeTab] || 'cpu'
    setSortKey(nextSort)
    setSortDir('desc')
    setPage(1)
  }, [activeTab])

  useEffect(() => {
    setPage(1)
  }, [filter, userOnly, currentUser, sortKey, sortDir, pageSize])

  const enriched = useMemo(() => {
    return processes.map((process) => ({
      ...process,
      ...deriveProcess(process)
    }))
  }, [processes])

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase()
    let list = enriched

    if (userOnly && currentUser) {
      list = list.filter((item) => (item.user || '').toLowerCase() === currentUser.toLowerCase())
    }

    if (!term) return list

    return list.filter((item) => {
      return (
        String(item.pid).includes(term) ||
        item.name.toLowerCase().includes(term) ||
        (item.user || '').toLowerCase().includes(term) ||
        (STATE_LABELS[item.state] || item.state).toLowerCase().includes(term)
      )
    })
  }, [enriched, filter, userOnly, currentUser])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1

    const getValue = (item, key) => {
      switch (key) {
        case 'pid':
          return item.pid
        case 'cpu':
          return item.cpu_percent || 0
        case 'mem':
          return item.vmrss_kb || 0
        case 'threads':
          return item.threads || 0
        case 'wake':
          return item.wakeUps || 0
        case 'gpu':
          return item.gpuPercent || 0
        case 'ports':
          return item.ports || 0
        case 'energy':
          return item.energyImpact || 0
        case 'diskRead':
          return item.diskReadKb || 0
        case 'diskWrite':
          return item.diskWriteKb || 0
        case 'netIn':
          return item.netInKb || 0
        case 'netOut':
          return item.netOutKb || 0
        case 'user':
          return (item.user || '').toLowerCase()
        case 'name':
          return item.name
        case 'kind':
          return item.kind || ''
        default:
          return 0
      }
    }

    list.sort((a, b) => {
      const av = getValue(a, sortKey)
      const bv = getValue(b, sortKey)
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dir
      }
      return (av - bv) * dir
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

  const selectedProcess = useMemo(() => {
    if (!selectedPid) return null
    return enriched.find((item) => item.pid === selectedPid) || null
  }, [enriched, selectedPid])

  const totalThreads = useMemo(() => {
    return enriched.reduce((sum, item) => sum + item.threads, 0)
  }, [enriched])

  const memoryUsed = useMemo(() => {
    return processes.reduce((sum, item) => sum + (item.vmrss_kb || 0), 0)
  }, [processes])

  const memoryPressure = memTotalKb > 0 ? clamp((memoryUsed / memTotalKb) * 100, 0, 100) : 0

  const latestCpu = history[history.length - 1] || { user: 0, system: 0, idle: 100 }
  const chartValues = history.length
    ? history
    : Array.from({ length: HISTORY_POINTS }, () => ({
        user: 0,
        system: 0,
        idle: 100,
        threads: 0,
        memory: 0
      }))
  const userSeries = chartValues.map((item) => item.user)
  const systemSeries = chartValues.map((item) => item.system)
  const totalSeries = chartValues.map((item) => item.user + item.system)
  const chartWidth = 280
  const chartHeight = 84
  const totalArea = buildAreaPath(totalSeries, chartWidth, chartHeight)
  const userPath = buildLinePath(userSeries, chartWidth, chartHeight)
  const systemPath = buildLinePath(systemSeries, chartWidth, chartHeight)

  const sparkWidth = 140
  const sparkHeight = 32
  const threadSeries = chartValues.map((item) => item.threads || 0)
  const memorySeries = chartValues.map((item) => item.memory || 0)
  const threadMax = Math.max(...threadSeries, 1)
  const memoryMax = Math.max(...memorySeries, 1)
  const threadPath = buildLinePath(threadSeries, sparkWidth, sparkHeight, threadMax)
  const memoryArea = buildAreaPath(memorySeries, sparkWidth, sparkHeight, memoryMax)
  const memoryPath = buildLinePath(memorySeries, sparkWidth, sparkHeight, memoryMax)

  const pressureSeries = memTotalKb
    ? memorySeries.map((value) => (value / memTotalKb) * 100)
    : memorySeries.map((value) => (value / memoryMax) * 100)
  const pressureArea = buildAreaPath(pressureSeries, chartWidth, chartHeight)
  const pressureLine = buildLinePath(pressureSeries, chartWidth, chartHeight)

  const cpuTotal = clamp(latestCpu.user + latestCpu.system, 0, 100)
  const appMemory = memoryUsed * 0.55
  const wiredMemory = memoryUsed * 0.25
  const compressedMemory = memoryUsed * 0.2
  const cachedFiles = memTotalKb ? Math.max(memTotalKb - memoryUsed, 0) * 0.4 : 0
  const swapUsed = memTotalKb ? Math.max(memoryUsed - memTotalKb, 0) + memTotalKb * 0.05 : 0

  const isSelectedOwn = selectedProcess
    ? !currentUser || (selectedProcess.user || '').toLowerCase() === currentUser.toLowerCase()
    : false

  const nameCell = (process) => (
    <div className="cell name">
      <span className="process-dot" />
      <span className="label">{process.name}</span>
      <span className="state">{STATE_LABELS[process.state] || process.state}</span>
    </div>
  )

  const columns = useMemo(() => {
    if (activeTab === 'Memory') {
      return [
        { key: 'name', label: 'Process Name', sortKey: 'name', render: nameCell },
        {
          key: 'memory',
          label: 'Memory',
          sortKey: 'mem',
          render: (process) => <div className="cell number">{formatKb(process.vmrss_kb)}</div>
        },
        {
          key: 'threads',
          label: 'Threads',
          sortKey: 'threads',
          render: (process) => <div className="cell number">{process.threads}</div>
        },
        {
          key: 'ports',
          label: 'Ports',
          sortKey: 'ports',
          render: (process) => <div className="cell number">{process.ports}</div>
        },
        {
          key: 'pid',
          label: 'PID',
          sortKey: 'pid',
          render: (process) => <div className="cell number">{process.pid}</div>
        },
        {
          key: 'user',
          label: 'User',
          sortKey: 'user',
          render: (process) => <div className="cell user">{process.user || '—'}</div>
        }
      ]
    }

    if (activeTab === 'Energy') {
      return [
        { key: 'name', label: 'Process Name', sortKey: 'name', render: nameCell },
        {
          key: 'energy',
          label: 'Energy Impact',
          sortKey: 'energy',
          render: (process) => <div className="cell number">{process.energyImpact.toFixed(1)}</div>
        },
        {
          key: 'avgEnergy',
          label: 'Avg Energy',
          sortKey: 'energy',
          render: (process) => <div className="cell number">{process.avgEnergy.toFixed(1)}</div>
        },
        {
          key: 'appNap',
          label: 'App Nap',
          render: (process) => <div className="cell">{process.appNap}</div>
        },
        {
          key: 'pid',
          label: 'PID',
          sortKey: 'pid',
          render: (process) => <div className="cell number">{process.pid}</div>
        },
        {
          key: 'user',
          label: 'User',
          sortKey: 'user',
          render: (process) => <div className="cell user">{process.user || '—'}</div>
        }
      ]
    }

    if (activeTab === 'Disk') {
      return [
        { key: 'name', label: 'Process Name', sortKey: 'name', render: nameCell },
        {
          key: 'diskRead',
          label: 'Read/s',
          sortKey: 'diskRead',
          render: (process) => <div className="cell number">{formatRate(process.diskReadKb)}</div>
        },
        {
          key: 'diskWrite',
          label: 'Write/s',
          sortKey: 'diskWrite',
          render: (process) => <div className="cell number">{formatRate(process.diskWriteKb)}</div>
        },
        {
          key: 'readOps',
          label: 'Reads',
          render: (process) => <div className="cell number">{process.readOps}</div>
        },
        {
          key: 'writeOps',
          label: 'Writes',
          render: (process) => <div className="cell number">{process.writeOps}</div>
        },
        {
          key: 'pid',
          label: 'PID',
          sortKey: 'pid',
          render: (process) => <div className="cell number">{process.pid}</div>
        },
        {
          key: 'user',
          label: 'User',
          sortKey: 'user',
          render: (process) => <div className="cell user">{process.user || '—'}</div>
        }
      ]
    }

    if (activeTab === 'Network') {
      return [
        { key: 'name', label: 'Process Name', sortKey: 'name', render: nameCell },
        {
          key: 'netIn',
          label: 'Data In/s',
          sortKey: 'netIn',
          render: (process) => <div className="cell number">{formatRate(process.netInKb)}</div>
        },
        {
          key: 'netOut',
          label: 'Data Out/s',
          sortKey: 'netOut',
          render: (process) => <div className="cell number">{formatRate(process.netOutKb)}</div>
        },
        {
          key: 'packetsIn',
          label: 'Packets In/s',
          render: (process) => <div className="cell number">{process.packetsIn}</div>
        },
        {
          key: 'packetsOut',
          label: 'Packets Out/s',
          render: (process) => <div className="cell number">{process.packetsOut}</div>
        },
        {
          key: 'pid',
          label: 'PID',
          sortKey: 'pid',
          render: (process) => <div className="cell number">{process.pid}</div>
        },
        {
          key: 'user',
          label: 'User',
          sortKey: 'user',
          render: (process) => <div className="cell user">{process.user || '—'}</div>
        }
      ]
    }

    return [
      { key: 'name', label: 'Process Name', sortKey: 'name', render: nameCell },
      {
        key: 'cpu',
        label: '% CPU',
        sortKey: 'cpu',
        render: (process) => <div className="cell number">{formatPercent(process.cpu_percent)}</div>
      },
      {
        key: 'cpuTime',
        label: 'CPU Time',
        render: (process) => (
          <div className="cell mono">{formatDuration(process.cpuTimeSeconds, process.seed)}</div>
        )
      },
      {
        key: 'threads',
        label: 'Threads',
        sortKey: 'threads',
        render: (process) => <div className="cell number">{process.threads}</div>
      },
      {
        key: 'wake',
        label: 'Idle Wake-Ups',
        sortKey: 'wake',
        render: (process) => <div className="cell number">{process.wakeUps}</div>
      },
      {
        key: 'kind',
        label: 'Kind',
        sortKey: 'kind',
        render: (process) => <div className="cell">{process.kind}</div>
      },
      {
        key: 'gpu',
        label: '% GPU',
        sortKey: 'gpu',
        render: (process) => <div className="cell number">{formatPercent(process.gpuPercent)}</div>
      },
      {
        key: 'gpuTime',
        label: 'GPU Time',
        render: (process) => (
          <div className="cell mono">{formatDuration(process.gpuTimeSeconds, process.seed)}</div>
        )
      },
      {
        key: 'pid',
        label: 'PID',
        sortKey: 'pid',
        render: (process) => <div className="cell number">{process.pid}</div>
      },
      {
        key: 'user',
        label: 'User',
        sortKey: 'user',
        render: (process) => <div className="cell user">{process.user || '—'}</div>
      }
    ]
  }, [activeTab])

  const pageStart = sorted.length ? (page - 1) * pageSize + 1 : 0
  const pageEnd = Math.min(page * pageSize, sorted.length)

  const statsView = activeTab === 'Memory' ? (
    <div className="stats">
      <div className="stat-card">
        <div className="stat-heading">
          <span>Memory Pressure</span>
          <strong>{formatPercent(memoryPressure, 1)}</strong>
        </div>
        <div className="meter">
          <span style={{ width: `${memoryPressure}%` }} />
        </div>
        <div className="stat-meta">
          <span>Used {formatKb(memoryUsed)}</span>
          <span>Total {memTotalKb ? formatKb(memTotalKb) : '—'}</span>
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-heading">
          <span>Threads Used</span>
          <strong>{totalThreads.toLocaleString()}</strong>
        </div>
        <div className="sparkline">
          <svg viewBox={`0 0 ${sparkWidth} ${sparkHeight}`} aria-hidden="true">
            <path d={threadPath} className="spark thread" />
          </svg>
        </div>
        <div className="stat-meta">
          <span>{processes.length.toLocaleString()} processes</span>
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-heading">
          <span>Memory Used</span>
          <strong>{formatKb(memoryUsed)}</strong>
        </div>
        <div className="sparkline memory">
          <svg viewBox={`0 0 ${sparkWidth} ${sparkHeight}`} aria-hidden="true">
            <defs>
              <linearGradient id="memFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(123, 220, 169, 0.45)" />
                <stop offset="100%" stopColor="rgba(123, 220, 169, 0.05)" />
              </linearGradient>
            </defs>
            <path d={memoryArea} className="spark-area" fill="url(#memFill)" />
            <path d={memoryPath} className="spark memory" />
          </svg>
        </div>
        <div className="stat-meta">
          <span>Total RSS</span>
        </div>
      </div>
    </div>
  ) : (
    <div className="stats">
      <div className="stat-card">
        <div className="stat-heading">
          <span>CPU Total</span>
          <strong>{formatPercent(cpuTotal, 1)}</strong>
        </div>
        <div className="meter">
          <span style={{ width: `${cpuTotal}%` }} />
        </div>
        <div className="stat-meta">
          <span>System {formatPercent(latestCpu.system, 1)}</span>
          <span>User {formatPercent(latestCpu.user, 1)}</span>
          <span>Idle {formatPercent(latestCpu.idle, 1)}</span>
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-heading">
          <span>Threads Used</span>
          <strong>{totalThreads.toLocaleString()}</strong>
        </div>
        <div className="sparkline">
          <svg viewBox={`0 0 ${sparkWidth} ${sparkHeight}`} aria-hidden="true">
            <path d={threadPath} className="spark thread" />
          </svg>
        </div>
        <div className="stat-meta">
          <span>{processes.length.toLocaleString()} processes</span>
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-heading">
          <span>Memory Used</span>
          <strong>{formatKb(memoryUsed)}</strong>
        </div>
        <div className="sparkline memory">
          <svg viewBox={`0 0 ${sparkWidth} ${sparkHeight}`} aria-hidden="true">
            <defs>
              <linearGradient id="memFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(123, 220, 169, 0.45)" />
                <stop offset="100%" stopColor="rgba(123, 220, 169, 0.05)" />
              </linearGradient>
            </defs>
            <path d={memoryArea} className="spark-area" fill="url(#memFill)" />
            <path d={memoryPath} className="spark memory" />
          </svg>
        </div>
        <div className="stat-meta">
          <span>Total RSS</span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="app">
      <div className="window">
        <div className="window-top">
          <div className="window-controls" aria-hidden="true">
            <span className="dot close" />
            <span className="dot minimize" />
            <span className="dot zoom" />
          </div>
          <div className="window-title">
            <div className="title">Activity Monitor</div>
            <div className="scope-toggle">
              <button
                type="button"
                className={!userOnly ? 'active' : ''}
                onClick={() => setUserOnly(false)}
              >
                All Processes
              </button>
              <button
                type="button"
                className={userOnly ? 'active' : ''}
                onClick={() => setUserOnly(true)}
              >
                My Processes{currentUser ? ` (${currentUser})` : ''}
              </button>
            </div>
          </div>
          <div className="toolbar-actions">
            <button
              type="button"
              className="icon-button"
              disabled={!selectedProcess}
              onClick={() => selectedProcess && setDetails(selectedProcess)}
              title="Inspect"
            >
              i
            </button>
            <button
              type="button"
              className="icon-button danger"
              disabled={!selectedProcess || !isSelectedOwn}
              onClick={() =>
                selectedProcess &&
                killProcess(selectedProcess.pid, selectedProcess.name, selectedProcess.user)
              }
              title={
                !selectedProcess
                  ? 'Select a process'
                  : isSelectedOwn
                    ? 'Terminate'
                    : 'Permission denied'
              }
            >
              ×
            </button>
          </div>
        </div>

        <div className="toolbar">
          <div className="segmented">
            {TABS.map((tab) => (
              <button
                type="button"
                key={tab}
                className={activeTab === tab ? 'active' : ''}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="toolbar-right">
            <label className="switch">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              <span>Auto refresh</span>
            </label>
            <div className="search">
              <span className="search-icon" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          </div>
        </div>

        {error ? <div className="banner error">{error}</div> : null}

        {statsView}

        <div className={`table ${activeTab.toLowerCase()}`}>
          <div className="table-head">
            {columns.map((column) =>
              column.sortKey ? (
                <button key={column.key} type="button" onClick={() => toggleSort(column.sortKey)}>
                  {column.label}
                  {sortKey === column.sortKey ? (
                    <span>{sortDir === 'asc' ? '↑' : '↓'}</span>
                  ) : null}
                </button>
              ) : (
                <div key={column.key} className="header-static">
                  {column.label}
                </div>
              )
            )}
          </div>
          <div className="table-body">
            {loading ? <div className="empty">Loading processes...</div> : null}
            {!loading && !sorted.length ? (
              <div className="empty">No matching processes found.</div>
            ) : null}
            {paged.map((process) => {
              const high =
                (process.cpu_percent || 0) >= CPU_ALERT ||
                (process.mem_percent || 0) >= MEM_ALERT
              const selected = selectedPid === process.pid
              return (
                <div
                  key={`${process.pid}-${process.name}`}
                  className={`row ${selected ? 'selected' : ''} ${high ? 'alert' : ''}`}
                  onClick={() => setSelectedPid(process.pid)}
                  onDoubleClick={() => setDetails(process)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setDetails(process)
                  }}
                >
                  {columns.map((column) => (
                    <div key={`${process.pid}-${column.key}`} className="cell-wrap">
                      {column.render(process)}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
          <div className="pagination">
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
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                <option value="15">15</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <div className="page-meta">
              Showing {pageStart}-{pageEnd} of {sorted.length}
            </div>
          </div>
        </div>

        {activeTab === 'Memory' ? (
          <div className="footer memory">
            <div className="memory-chart">
              <span>Memory Pressure</span>
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} aria-hidden="true">
                <defs>
                  <linearGradient id="pressureFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(245, 195, 92, 0.55)" />
                    <stop offset="100%" stopColor="rgba(245, 195, 92, 0.05)" />
                  </linearGradient>
                </defs>
                <path d={pressureArea} fill="url(#pressureFill)" className="pressure-area" />
                <path d={pressureLine} className="pressure-line" />
              </svg>
            </div>
            <div className="memory-panel">
              <div className="memory-block">
                <div className="memory-row">
                  <span>Physical Memory</span>
                  <strong>{memTotalKb ? formatKb(memTotalKb) : '—'}</strong>
                </div>
                <div className="memory-row">
                  <span>Memory Used</span>
                  <strong>{formatKb(memoryUsed)}</strong>
                </div>
                <div className="memory-row">
                  <span>Cached Files</span>
                  <strong>{formatKb(cachedFiles)}</strong>
                </div>
                <div className="memory-row">
                  <span>Swap Used</span>
                  <strong>{formatKb(swapUsed)}</strong>
                </div>
              </div>
              <div className="memory-block">
                <div className="memory-row">
                  <span>App Memory</span>
                  <strong>{formatKb(appMemory)}</strong>
                </div>
                <div className="memory-row">
                  <span>Wired Memory</span>
                  <strong>{formatKb(wiredMemory)}</strong>
                </div>
                <div className="memory-row">
                  <span>Compressed</span>
                  <strong>{formatKb(compressedMemory)}</strong>
                </div>
                <div className="memory-row">
                  <span>Threads</span>
                  <strong>{totalThreads.toLocaleString()}</strong>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="footer">
            <div className="footer-card">
              <div className="stat">
                <span>System:</span>
                <strong>{formatPercent(latestCpu.system, 2)}</strong>
              </div>
              <div className="stat">
                <span>User:</span>
                <strong>{formatPercent(latestCpu.user, 2)}</strong>
              </div>
              <div className="stat">
                <span>Idle:</span>
                <strong>{formatPercent(latestCpu.idle, 2)}</strong>
              </div>
            </div>

            <div className="footer-chart">
              <span>CPU LOAD</span>
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} aria-hidden="true">
                <defs>
                  <linearGradient id="cpuFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(103, 198, 255, 0.55)" />
                    <stop offset="100%" stopColor="rgba(103, 198, 255, 0.05)" />
                  </linearGradient>
                </defs>
                <path d={totalArea} className="area" fill="url(#cpuFill)" />
                <path d={systemPath} className="line system" />
                <path d={userPath} className="line user" />
              </svg>
            </div>

            <div className="footer-card">
              <div className="stat">
                <span>Threads:</span>
                <strong>{totalThreads.toLocaleString()}</strong>
              </div>
              <div className="stat">
                <span>Processes:</span>
                <strong>{processes.length.toLocaleString()}</strong>
              </div>
              <div className="stat">
                <span>Memory:</span>
                <strong>{formatKb(memoryUsed)}</strong>
              </div>
            </div>
          </div>
        )}
      </div>

      {details ? (
        <div className="modal" onClick={() => setDetails(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Process Details</h2>
                <p>{details.name}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setDetails(null)}>
                ×
              </button>
            </div>
            <div className="detail-grid">
              <div>
                <span>PID</span>
                <strong>{details.pid}</strong>
              </div>
              <div>
                <span>User</span>
                <strong>{details.user || '—'}</strong>
              </div>
              <div>
                <span>State</span>
                <strong>{STATE_LABELS[details.state] || details.state}</strong>
              </div>
              <div>
                <span>CPU %</span>
                <strong>{formatPercent(details.cpu_percent)}</strong>
              </div>
              <div>
                <span>Mem %</span>
                <strong>{formatPercent(details.mem_percent)}</strong>
              </div>
              <div>
                <span>RSS</span>
                <strong>{formatKb(details.vmrss_kb)}</strong>
              </div>
              <div>
                <span>VM Size</span>
                <strong>{formatKb(details.vmsize_kb)}</strong>
              </div>
              <div>
                <span>Threads</span>
                <strong>{details.threads}</strong>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setDetails(null)}>
                Close
              </button>
              <button
                type="button"
                className="danger"
                disabled={
                  currentUser && (details.user || '').toLowerCase() !== currentUser.toLowerCase()
                }
                onClick={() => killProcess(details.pid, details.name, details.user)}
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
