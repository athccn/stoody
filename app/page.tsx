'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { 
  Flame, 
  Hourglass, 
  Coffee, 
  Watch, 
  Play, 
  Pause, 
  RotateCcw, 
  LayoutDashboard, 
  BarChart3, 
  Trophy, 
  LogOut,
  Calendar,
  Clock,
  Target,
  Volume2
} from 'lucide-react'

type Mode = 'pomodoro' | 'timer' | 'break' | 'stopwatch'
type View = 'dashboard' | 'analytics' | 'leaderboard'

interface HeatMapDay {
  dateKey: string
  minutes: number
  level: number
}

interface PresenceUser {
  userId: string
  name: string
  avatar?: string
  isStudying: boolean
  subject: string
  startedAt?: number
}

interface LeaderboardUser {
  id: string
  username: string
  avatar_url?: string
  total_minutes: number
  streak: number
  is_online?: boolean
  current_subject?: string
}

export default function StoodyApp() {
  const [user, setUser] = useState<any>(null)
  const [currentView, setCurrentView] = useState<View>('dashboard')
  
  // Timer & Editable State
  const [mode, setMode] = useState<Mode>('pomodoro')
  const [customMinutes, setCustomMinutes] = useState<number>(25)
  const [inputMins, setInputMins] = useState<string>('25')
  const [inputSecs, setInputSecs] = useState<string>('00')
  const [subject, setSubject] = useState<string>('Linear Algebra')
  const [timeLeft, setTimeLeft] = useState<number>(25 * 60)
  const [stopwatchElapsed, setStopwatchElapsed] = useState<number>(0)
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [saveStatus, setSaveStatus] = useState<string>('')
  const [activeLeaderboardTab, setActiveLeaderboardTab] = useState<'weekly' | 'streak'>('weekly')

  // Realtime Presence & Leaderboard state
  const [onlineUsers, setOnlineUsers] = useState<Record<string, PresenceUser>>({})
  const [leaderboardUsers, setLeaderboardUsers] = useState<LeaderboardUser[]>([])

  // Analytics State
  const [analyticsData, setAnalyticsData] = useState<{
    totalMinutes: number
    sessionCount: number
    activeDaysCount: number
    dailyBreakdown: Record<string, number>
    splinePoints: { label: string; hours: number; dateKey: string }[]
  }>({
    totalMinutes: 0,
    sessionCount: 0,
    activeDaysCount: 0,
    dailyBreakdown: {},
    splinePoints: [],
  })

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const presenceChannelRef = useRef<any>(null)

  // 1. Synthesize soft audio notification on completion
  const playCompletionChime = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime) // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.3) // A5
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start()
      osc.stop(audioCtx.currentTime + 0.8)
    } catch {
      // AudioContext policy suppression fallback
    }
  }, [])

  // 2. Fetch User Analytics from Supabase
  const loadUserAnalytics = useCallback(async (userId: string) => {
    const { data: sessions, error } = await supabase
      .from('study_sessions')
      .select('duration_minutes, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (error || !sessions) return

    let totalMins = 0
    const dailyMap: Record<string, number> = {}

    sessions.forEach((s) => {
      const mins = Number(s.duration_minutes) || 0
      totalMins += mins
      const dayKey = s.created_at.split('T')[0]
      dailyMap[dayKey] = (dailyMap[dayKey] || 0) + mins
    })

    const points: { label: string; hours: number; dateKey: string }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateKey = d.toISOString().split('T')[0]
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const hours = Number(((dailyMap[dateKey] || 0) / 60).toFixed(1))
      points.push({ label, hours, dateKey })
    }

    setAnalyticsData({
      totalMinutes: totalMins,
      sessionCount: sessions.length,
      activeDaysCount: Object.keys(dailyMap).length,
      dailyBreakdown: dailyMap,
      splinePoints: points,
    })
  }, [])

  // 3. Fetch Leaderboard Data
  const loadLeaderboardData = useCallback(async () => {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, current_streak')

    const { data: sessions } = await supabase
      .from('study_sessions')
      .select('user_id, duration_minutes')

    if (!profiles) return

    const userTotals: Record<string, number> = {}
    sessions?.forEach((s) => {
      userTotals[s.user_id] = (userTotals[s.user_id] || 0) + Number(s.duration_minutes || 0)
    })

    const formatted: LeaderboardUser[] = profiles.map((p) => ({
      id: p.id,
      username: p.username || 'Anonymous',
      avatar_url: p.avatar_url,
      total_minutes: userTotals[p.id] || 0,
      streak: p.current_streak || 1
    }))

    formatted.sort((a, b) => b.total_minutes - a.total_minutes)
    setLeaderboardUsers(formatted)
  }, [])

  // 4. Session & Auth listener
  useEffect(() => {
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
      if (session?.user?.id) {
        loadUserAnalytics(session.user.id)
      }
      loadLeaderboardData()
    }
    fetchSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user?.id) {
        loadUserAnalytics(session.user.id)
      }
      loadLeaderboardData()
    })

    return () => subscription.unsubscribe()
  }, [loadUserAnalytics, loadLeaderboardData])

  // 5. Supabase Realtime Presence Channel
  useEffect(() => {
    const channel = supabase.channel('stoody-live-presence', {
      config: { presence: { key: user?.id || 'guest-' + Math.random().toString(36).substring(7) } }
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const activeUsers: Record<string, PresenceUser> = {}
        Object.keys(state).forEach((key) => {
          const pres = (state[key] as any)?.[0]
          if (pres) activeUsers[key] = pres
        })
        setOnlineUsers(activeUsers)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId: user?.id || 'guest',
            name: user?.user_metadata?.full_name || 'Guest User',
            isStudying: isRunning,
            subject: subject,
            startedAt: isRunning ? Date.now() : undefined
          })
        }
      })

    presenceChannelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [user, isRunning, subject])

  // 6. Automated session logger
  const autoLogSession = useCallback(async (durationMinutes: number) => {
    if (durationMinutes <= 0) return

    const { data: { session } } = await supabase.auth.getSession()
    const currentUser = session?.user ?? user

    if (currentUser) {
      setSaveStatus('Saving session...')
      const { error } = await supabase.from('study_sessions').insert({
        user_id: currentUser.id,
        duration_minutes: durationMinutes,
        subject: subject || 'General',
        mode: mode,
      })

      if (!error) {
        setSaveStatus(`Logged ${durationMinutes}m automatically!`)
        loadUserAnalytics(currentUser.id)
        loadLeaderboardData()
        setTimeout(() => setSaveStatus(''), 4000)
      } else {
        setSaveStatus('Failed to sync session')
      }
    }
  }, [user, subject, mode, loadUserAnalytics, loadLeaderboardData])

  // 7. Synchronize input boxes with seconds whenever timer updates
  useEffect(() => {
    if (mode !== 'stopwatch') {
      const mins = Math.floor(timeLeft / 60)
      const secs = timeLeft % 60
      setInputMins(String(mins).padStart(2, '0'))
      setInputSecs(String(secs).padStart(2, '0'))
    }
  }, [timeLeft, mode])

  // 8. Direct digit edit handlers
  const handleMinuteInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 3)
    setInputMins(val)
    const numericMinutes = parseInt(val || '0', 10)
    const numericSeconds = parseInt(inputSecs || '0', 10)
    const newTotal = numericMinutes * 60 + numericSeconds
    setTimeLeft(newTotal)
    setCustomMinutes(Math.max(1, Math.round(newTotal / 60)))
  }

  const handleSecondInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 2)
    const clamped = Math.min(59, parseInt(val || '0', 10))
    setInputSecs(String(clamped).padStart(2, '0'))
    const numericMinutes = parseInt(inputMins || '0', 10)
    const newTotal = numericMinutes * 60 + clamped
    setTimeLeft(newTotal)
    setCustomMinutes(Math.max(1, Math.round(newTotal / 60)))
  }

  // 9. Mode switch logic
  const switchMode = (newMode: Mode) => {
    setIsRunning(false)
    setMode(newMode)
    if (newMode === 'pomodoro') {
      setCustomMinutes(25)
      setTimeLeft(25 * 60)
    } else if (newMode === 'break') {
      setCustomMinutes(5)
      setTimeLeft(5 * 60)
    } else if (newMode === 'timer') {
      setTimeLeft(customMinutes * 60)
    } else if (newMode === 'stopwatch') {
      setStopwatchElapsed(0)
    }
  }

  // 10. Timer ticking loop
  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        if (mode === 'stopwatch') {
          setStopwatchElapsed((prev) => prev + 1)
        } else {
          setTimeLeft((prev) => {
            if (prev <= 1) {
              clearInterval(timerRef.current!)
              setIsRunning(false)
              playCompletionChime()
              autoLogSession(customMinutes)
              return 0
            }
            return prev - 1
          })
        }
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRunning, mode, customMinutes, autoLogSession, playCompletionChime])

  const toggleTimer = () => {
    if (isRunning) {
      if (mode === 'stopwatch') {
        const mins = Math.round(stopwatchElapsed / 60)
        if (mins >= 1) autoLogSession(mins)
      } else {
        const plannedSeconds = customMinutes * 60
        const elapsedSeconds = plannedSeconds - timeLeft
        const elapsedMinutes = Math.floor(elapsedSeconds / 60)
        if (elapsedMinutes >= 1) autoLogSession(elapsedMinutes)
      }
      setIsRunning(false)
    } else {
      setIsRunning(true)
    }
  }

  const resetTimer = () => {
    setIsRunning(false)
    if (mode === 'stopwatch') {
      setStopwatchElapsed(0)
    } else {
      setTimeLeft(customMinutes * 60)
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  // 11. Heat Map Grid generator
  const heatMapDays = useMemo(() => {
    const days: HeatMapDay[] = []
    const totalDays = 52 * 7
    const today = new Date()

    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(today.getDate() - i)
      const dateKey = d.toISOString().split('T')[0]
      const mins = analyticsData.dailyBreakdown[dateKey] || 0
      
      let level = 0
      if (mins > 0 && mins <= 30) level = 1
      else if (mins > 30 && mins <= 60) level = 2
      else if (mins > 60 && mins <= 120) level = 3
      else if (mins > 120) level = 4

      days.push({ dateKey, minutes: mins, level })
    }
    return days
  }, [analyticsData.dailyBreakdown])

  // 12. Dynamic 14-Day Spline Curve
  const splinePath = useMemo(() => {
    const pts = analyticsData.splinePoints
    if (!pts.length) return ''
    const maxVal = Math.max(...pts.map((p) => p.hours), 1.5)
    const width = 500
    const height = 120
    const step = width / (pts.length - 1)

    const coords = pts.map((p, index) => {
      const x = index * step
      const y = height - (p.hours / maxVal) * (height - 20) - 10
      return { x, y }
    })

    return coords.reduce((acc, pt, idx, arr) => {
      if (idx === 0) return `M ${pt.x},${pt.y}`
      const prev = arr[idx - 1]
      const cp1x = prev.x + (pt.x - prev.x) / 2
      const cp1y = prev.y
      const cp2x = prev.x + (pt.x - prev.x) / 2
      const cp2y = pt.y
      return `${acc} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${pt.x},${pt.y}`
    }, '')
  }, [analyticsData.splinePoints])

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans selection:bg-purple-600/30">
      {/* Top Navbar */}
      <header className="border-b border-zinc-800/80 px-6 py-4 flex items-center justify-between backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold shadow-lg shadow-purple-600/20">
            S
          </div>
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
            Stoody
          </span>
        </div>

        {/* View Switchers */}
        <div className="flex items-center gap-1 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800">
          <button
            onClick={() => setCurrentView('dashboard')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              currentView === 'dashboard' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => setCurrentView('analytics')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              currentView === 'analytics' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Analytics
          </button>
          <button
            onClick={() => setCurrentView('leaderboard')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
              currentView === 'leaderboard' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Trophy className="w-4 h-4" />
            Leaderboard
          </button>
        </div>

        {/* Auth / Account Controls */}
        <div>
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-300 hidden sm:inline font-medium">
                {user.user_metadata?.full_name || user.email}
              </span>
              <button
                onClick={() => supabase.auth.signOut().then(() => setUser(null))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-xs font-medium text-zinc-300 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold transition shadow"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/>
                <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.3-6.7-5.3L1.6 16c1.9 3.8 5.8 7 10.4 7z"/>
                <path fill="#FBBC05" d="M5.3 14.7c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.6 7.2C.6 9.2 0 11.5 0 14s.6 4.8 1.6 6.8l3.7-2.9z"/>
                <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.3 8.9 5 12 5z"/>
              </svg>
              Sign In with Google
            </button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 md:p-8 space-y-6">
        {/* VIEW 1: DASHBOARD */}
        {currentView === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Banner */}
            <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800/80 p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
                  <Flame className="w-6 h-6 fill-orange-500/20" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-white">{analyticsData.activeDaysCount} Days</span>
                    <span className="text-xs bg-orange-500/20 text-orange-300 font-medium px-2 py-0.5 rounded-full border border-orange-500/30">
                      Active Days
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">Focus block running with automated persistence.</p>
                </div>
              </div>
              {saveStatus && (
                <div className="text-xs font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-3 py-1.5 rounded-lg animate-pulse">
                  {saveStatus}
                </div>
              )}
            </div>

            {/* Timer Core */}
            <div className="rounded-3xl bg-zinc-900/40 border border-zinc-800 p-8 flex flex-col items-center justify-center relative overflow-hidden backdrop-blur-xl">
              <div className="absolute w-72 h-72 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

              {/* Mode Switchers */}
              <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 bg-zinc-900/80 rounded-2xl border border-zinc-800/90 mb-8 z-10">
                <button
                  onClick={() => switchMode('pomodoro')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    mode === 'pomodoro' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" /> Pomodoro
                </button>
                <button
                  onClick={() => switchMode('timer')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    mode === 'timer' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Hourglass className="w-3.5 h-3.5" /> Custom Timer
                </button>
                <button
                  onClick={() => switchMode('break')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    mode === 'break' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Coffee className="w-3.5 h-3.5" /> Break
                </button>
                <button
                  onClick={() => switchMode('stopwatch')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    mode === 'stopwatch' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Watch className="w-3.5 h-3.5" /> Stopwatch
                </button>
              </div>

              {/* Directly Editable Big Timer Numbers */}
              <div className="text-7xl md:text-8xl font-black tracking-tight text-white mb-6 tabular-nums select-none z-10 font-mono">
                {mode === 'stopwatch' ? (
                  <span>{formatTime(stopwatchElapsed)}</span>
                ) : (
                  <div className="flex items-center justify-center">
                    <input
                      type="text"
                      disabled={isRunning}
                      value={inputMins}
                      onChange={handleMinuteInput}
                      title={isRunning ? 'Pause timer to edit duration' : 'Click to type minutes'}
                      className="w-28 md:w-36 text-right bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-purple-500 focus:outline-none transition selection:bg-purple-600/40 cursor-pointer disabled:cursor-default"
                    />
                    <span className="mx-1 text-zinc-500">:</span>
                    <input
                      type="text"
                      disabled={isRunning}
                      value={inputSecs}
                      onChange={handleSecondInput}
                      title={isRunning ? 'Pause timer to edit duration' : 'Click to type seconds'}
                      className="w-28 md:w-36 text-left bg-transparent border-b-2 border-transparent hover:border-zinc-700 focus:border-purple-500 focus:outline-none transition selection:bg-purple-600/40 cursor-pointer disabled:cursor-default"
                    />
                  </div>
                )}
              </div>

              {/* Subject Input */}
              <div className="w-full max-w-sm space-y-3 z-10 mb-8">
                <div>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="What are you studying?"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition"
                  />
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3 z-10">
                <button
                  onClick={toggleTimer}
                  className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm transition shadow-lg shadow-purple-600/25 active:scale-95"
                >
                  {isRunning ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white" />}
                  {isRunning ? 'Pause & Auto-Save' : 'Start Focus'}
                </button>
                <button
                  onClick={resetTimer}
                  className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 transition"
                  title="Reset Timer"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: ANALYTICS */}
        {currentView === 'analytics' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-4">
                <div className="text-zinc-500 text-xs flex items-center gap-1.5 mb-1"><Clock className="w-3.5 h-3.5" /> Total Time</div>
                <div className="text-2xl font-bold text-white">
                  {Math.floor(analyticsData.totalMinutes / 60)}h {Math.round(analyticsData.totalMinutes % 60)}m
                </div>
                <div className="text-zinc-500 text-[11px] mt-1">{analyticsData.sessionCount} sessions</div>
              </div>

              <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-4">
                <div className="text-zinc-500 text-xs flex items-center gap-1.5 mb-1"><Target className="w-3.5 h-3.5" /> Avg Session</div>
                <div className="text-2xl font-bold text-white">
                  {analyticsData.sessionCount > 0 ? Math.round(analyticsData.totalMinutes / analyticsData.sessionCount) : 0}m
                </div>
                <div className="text-zinc-500 text-[11px] mt-1">per study block</div>
              </div>

              <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-4">
                <div className="text-zinc-500 text-xs flex items-center gap-1.5 mb-1"><Flame className="w-3.5 h-3.5 text-orange-400" /> Active Days</div>
                <div className="text-2xl font-bold text-white">{analyticsData.activeDaysCount} Days</div>
                <div className="text-zinc-500 text-[11px] mt-1">Total recorded</div>
              </div>

              <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-4">
                <div className="text-zinc-500 text-xs flex items-center gap-1.5 mb-1"><Calendar className="w-3.5 h-3.5" /> Total Sessions</div>
                <div className="text-2xl font-bold text-white">{analyticsData.sessionCount}</div>
                <div className="text-zinc-500 text-[11px] mt-1">Completed blocks</div>
              </div>
            </div>

            {/* Smoothed Purple Spline Card */}
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-white">Study Activity</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Daily focus time over the last 14 days</p>
                </div>
                <div className="flex gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800 text-[11px]">
                  <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-white font-medium">14D</span>
                </div>
              </div>
              
              <div className="h-44 w-full pt-4">
                {analyticsData.splinePoints.length > 0 ? (
                  <svg viewBox="0 0 500 120" className="w-full h-full overflow-visible">
                    <defs>
                      <linearGradient id="purpleGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    <path
                      d={splinePath}
                      fill="none"
                      stroke="#a855f7"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    {analyticsData.splinePoints.map((p, idx) => {
                      const maxVal = Math.max(...analyticsData.splinePoints.map((pt) => pt.hours), 1.5)
                      const step = 500 / (analyticsData.splinePoints.length - 1)
                      const cx = idx * step
                      const cy = 120 - (p.hours / maxVal) * 100 - 10
                      if (p.hours === 0) return null
                      return (
                        <g key={idx}>
                          <circle cx={cx} cy={cy} r="4" fill="#c084fc" />
                        </g>
                      )
                    })}
                  </svg>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                    No session activity recorded yet
                  </div>
                )}
              </div>
            </div>

            {/* 52-Week Emerald Heat Map */}
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-white">Study Heat Map</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {Math.floor(analyticsData.totalMinutes / 60)}h {Math.round(analyticsData.totalMinutes % 60)}m · {analyticsData.sessionCount} sessions · {analyticsData.activeDaysCount} active days
                  </p>
                </div>
                <div className="text-xs text-zinc-400 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800 font-mono">
                  2026
                </div>
              </div>
              
              <div className="overflow-x-auto pb-2">
                <div className="grid grid-flow-col grid-rows-7 gap-1.5 w-max">
                  {heatMapDays.map((day, i) => {
                    const colorClasses = [
                      'bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800/40',
                      'bg-emerald-950 border border-emerald-900',
                      'bg-emerald-800',
                      'bg-emerald-600',
                      'bg-emerald-400 ring-2 ring-emerald-300/40',
                    ]
                    return (
                      <div
                        key={i}
                        title={`${day.dateKey}: ${day.minutes}m`}
                        className={`w-3.5 h-3.5 rounded-[3px] transition ${colorClasses[day.level]}`}
                      />
                    )
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-1.5 text-[11px] text-zinc-500 mt-3">
                <span>Less</span>
                <span className="w-2.5 h-2.5 rounded-[2px] bg-zinc-900 border border-zinc-800" />
                <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-950" />
                <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-800" />
                <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-600" />
                <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-400" />
                <span>More</span>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: LIVE REALTIME LEADERBOARD */}
        {currentView === 'leaderboard' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Friends Leaderboard</h2>
                <p className="text-xs text-zinc-400">Live studying status & overall focus rankings</p>
              </div>
              <div className="flex gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800 text-xs">
                <button
                  onClick={() => setActiveLeaderboardTab('weekly')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition ${
                    activeLeaderboardTab === 'weekly' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Total Focus
                </button>
                <button
                  onClick={() => setActiveLeaderboardTab('streak')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition ${
                    activeLeaderboardTab === 'streak' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Streaks 🔥
                </button>
              </div>
            </div>

            <div className="rounded-2xl bg-zinc-900/40 border border-zinc-800/80 overflow-hidden divide-y divide-zinc-800/60">
              {leaderboardUsers.map((lbUser, index) => {
                const presence = onlineUsers[lbUser.id]
                const isCurrent = user?.id === lbUser.id
                const isOnline = Boolean(presence)
                const studyingNow = presence?.isStudying ?? (isCurrent && isRunning)
                const activeSubj = presence?.subject || (isCurrent ? subject : 'General')

                return (
                  <div
                    key={lbUser.id}
                    className={`p-4 flex items-center justify-between transition ${
                      isCurrent ? 'bg-purple-950/20 border-l-2 border-purple-500' : 'hover:bg-zinc-900/30'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold w-5">
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`}
                      </span>
                      <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-xs text-white uppercase">
                        {lbUser.username.slice(0, 2)}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {lbUser.username} {isCurrent && '(You)'}
                        </div>
                        {studyingNow ? (
                          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            Focusing on {activeSubj}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-amber-400' : 'bg-zinc-600'}`} />
                            {isOnline ? 'Idle' : 'Offline'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-white">
                        {Math.floor(lbUser.total_minutes / 60)}h {Math.round(lbUser.total_minutes % 60)}m
                      </div>
                      <div className="text-xs text-orange-400 font-medium">🔥 {lbUser.streak} Days</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}