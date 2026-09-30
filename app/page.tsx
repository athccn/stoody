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
  SkipForward,
  LayoutDashboard, 
  BarChart3, 
  Trophy, 
  LogOut,
  Calendar,
  Clock,
  Target,
  ShieldCheck,
  Users,
  TrendingUp,
  Sparkles,
  Sun,
  Moon
} from 'lucide-react'

type EngineMode = 'pomodoro' | 'timer' | 'stopwatch'
type PomodoroPhase = 'work' | 'shortBreak' | 'longBreak'
type View = 'dashboard' | 'analytics' | 'leaderboard'

interface HeatMapDay {
  dateKey: string
  label: string
  minutes: number
  level: number
  isToday: boolean
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

interface SessionLog {
  id: string
  duration_minutes: number
  subject: string
  mode: string
  created_at: string
}

interface DayBar {
  dayLabel: string
  dateKey: string
  minutes: number
  hours: number
  isToday: boolean
}

export default function StoodyApp() {
  const [user, setUser] = useState<any>(null)
  const [authLoading, setAuthLoading] = useState<boolean>(true)
  const [currentView, setCurrentView] = useState<View>('dashboard')
  
  // Timer Engines & States
  const [engineMode, setEngineMode] = useState<EngineMode>('pomodoro')
  const [pomoPhase, setPomoPhase] = useState<PomodoroPhase>('work')
  const [pomoRound, setPomoRound] = useState<number>(1)
  
  // Custom Timer inputs
  const [customMinutes, setCustomMinutes] = useState<number>(25)
  const [inputMins, setInputMins] = useState<string>('25')
  const [inputSecs, setInputSecs] = useState<string>('00')
  const [subject, setSubject] = useState<string>('Linear Algebra')
  const [timeLeft, setTimeLeft] = useState<number>(25 * 60)
  const [stopwatchElapsed, setStopwatchElapsed] = useState<number>(0)
  const [isRunning, setIsRunning] = useState<boolean>(false)
  const [saveStatus, setSaveStatus] = useState<string>('')
  const [activeLeaderboardTab, setActiveLeaderboardTab] = useState<'weekly' | 'streak'>('weekly')

  // Hover Tooltips
  const [hoveredPoint, setHoveredPoint] = useState<{
    label: string
    hours: number
    dateKey: string
    x: number
    y: number
  } | null>(null)
  const [hoveredHeatDay, setHoveredHeatDay] = useState<HeatMapDay | null>(null)
  const [hoveredBar, setHoveredBar] = useState<DayBar | null>(null)

  // Realtime Presence & Leaderboard state
  const [onlineUsers, setOnlineUsers] = useState<Record<string, PresenceUser>>({})
  const [leaderboardUsers, setLeaderboardUsers] = useState<LeaderboardUser[]>([])

  // Timestamp references
  const targetEndRef = useRef<number | null>(null)
  const stopwatchStartRef = useRef<number | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const presenceChannelRef = useRef<any>(null)

  // Anti-glitch Session & Mutex Refs
  const activeRunStartRef = useRef<number | null>(null)
  const isSavingRef = useRef<boolean>(false)

  // Analytics State
  const [analyticsData, setAnalyticsData] = useState<{
    totalMinutes: number
    sessionCount: number
    activeDaysCount: number
    currentStreak: number
    dailyBreakdown: Record<string, number>
    todayHoursDistribution: number[]
    recentSessions: SessionLog[]
    splinePoints: { label: string; hours: number; dateKey: string }[]
    sevenDayBars: DayBar[]
  }>({
    totalMinutes: 0,
    sessionCount: 0,
    activeDaysCount: 0,
    currentStreak: 1,
    dailyBreakdown: {},
    todayHoursDistribution: new Array(24).fill(0),
    recentSessions: [],
    splinePoints: [],
    sevenDayBars: []
  })

  const isBreakActive = engineMode === 'pomodoro' && pomoPhase !== 'work'

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  // Dynamic Browser Tab Title
  useEffect(() => {
    if (isRunning) {
      const formatted = formatTime(engineMode === 'stopwatch' ? stopwatchElapsed : timeLeft)
      const icon = isBreakActive ? '☕ ' : ''
      document.title = `(${formatted}) ${icon}Stoody`
    } else {
      document.title = 'Stoody'
    }
  }, [isRunning, timeLeft, stopwatchElapsed, engineMode, isBreakActive])

  // 1. Audio chime on completion
  const playCompletionChime = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.3)
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start()
      osc.stop(audioCtx.currentTime + 0.8)
    } catch {
      // AudioContext fallback
    }
  }, [])

  // 2. Fetch Leaderboard Data
  const loadLeaderboardData = useCallback(async () => {
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, current_streak')

    const { data: sessions, error: sErr } = await supabase
      .from('study_sessions')
      .select('user_id, duration_minutes')

    if (pErr || !profiles) return

    const userTotals: Record<string, number> = {}
    if (sessions && !sErr) {
      sessions.forEach((s) => {
        userTotals[s.user_id] = (userTotals[s.user_id] || 0) + Number(s.duration_minutes || 0)
      })
    }

    const formatted: LeaderboardUser[] = profiles.map((p) => ({
      id: p.id,
      username: p.username || 'Anonymous',
      avatar_url: p.avatar_url,
      total_minutes: userTotals[p.id] || 0,
      streak: p.current_streak && p.current_streak > 0 ? p.current_streak : 1
    }))

    formatted.sort((a, b) => b.total_minutes - a.total_minutes)
    setLeaderboardUsers(formatted)
  }, [])

  // 3. Calculate streak and load user analytics
  const loadUserAnalytics = useCallback(async (userId: string) => {
    const { data: sessions, error } = await supabase
      .from('study_sessions')
      .select('id, duration_minutes, subject, mode, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (error || !sessions) return

    let totalMins = 0
    const dailyMap: Record<string, number> = {}
    const todayStr = new Date().toISOString().split('T')[0]
    const todayDistribution = new Array(24).fill(0)

    sessions.forEach((s) => {
      const mins = Number(s.duration_minutes) || 0
      totalMins += mins
      const sessionDate = new Date(s.created_at)
      const dayKey = sessionDate.toISOString().split('T')[0]
      dailyMap[dayKey] = (dailyMap[dayKey] || 0) + mins

      if (dayKey === todayStr) {
        const hour = sessionDate.getHours()
        todayDistribution[hour] = (todayDistribution[hour] || 0) + mins
      }
    })

    let streak = 0
    const checkDate = new Date()
    while (true) {
      const key = checkDate.toISOString().split('T')[0]
      if (dailyMap[key] && dailyMap[key] > 0) {
        streak++
        checkDate.setDate(checkDate.getDate() - 1)
      } else {
        if (streak === 0) {
          checkDate.setDate(checkDate.getDate() - 1)
          const yKey = checkDate.toISOString().split('T')[0]
          if (dailyMap[yKey] && dailyMap[yKey] > 0) {
            streak++
            checkDate.setDate(checkDate.getDate() - 1)
            continue
          }
        }
        break
      }
    }
    const finalStreak = Math.max(streak, 1)
    await supabase.from('profiles').update({ current_streak: finalStreak }).eq('id', userId)

    const points: { label: string; hours: number; dateKey: string }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateKey = d.toISOString().split('T')[0]
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const hours = Number(((dailyMap[dateKey] || 0) / 60).toFixed(1))
      points.push({ label, hours, dateKey })
    }

    const bars: DayBar[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateKey = d.toISOString().split('T')[0]
      const dayLabel = i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' })
      const minutes = dailyMap[dateKey] || 0
      bars.push({
        dayLabel,
        dateKey,
        minutes,
        hours: Number((minutes / 60).toFixed(1)),
        isToday: i === 0
      })
    }

    const recent = [...sessions].reverse().slice(0, 5)

    setAnalyticsData({
      totalMinutes: totalMins,
      sessionCount: sessions.length,
      activeDaysCount: Object.keys(dailyMap).length,
      currentStreak: finalStreak,
      dailyBreakdown: dailyMap,
      todayHoursDistribution: todayDistribution,
      recentSessions: recent,
      splinePoints: points,
      sevenDayBars: bars
    })

    loadLeaderboardData()
  }, [loadLeaderboardData])

  // 4. Session & Auth Listener
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const activeUser = session?.user ?? null
        setUser(activeUser)
        if (activeUser?.id) {
          await supabase.from('profiles').upsert({
            id: activeUser.id,
            username: activeUser.user_metadata?.full_name || activeUser.email?.split('@')[0] || 'Student',
            avatar_url: activeUser.user_metadata?.avatar_url || ''
          }, { onConflict: 'id' })

          loadUserAnalytics(activeUser.id)
        }
        loadLeaderboardData()
      } finally {
        setAuthLoading(false)
      }
    }
    fetchSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const activeUser = session?.user ?? null
      setUser(activeUser)
      if (activeUser?.id) {
        await supabase.from('profiles').upsert({
          id: activeUser.id,
          username: activeUser.user_metadata?.full_name || activeUser.email?.split('@')[0] || 'Student',
          avatar_url: activeUser.user_metadata?.avatar_url || ''
        }, { onConflict: 'id' })

        loadUserAnalytics(activeUser.id)
      }
      loadLeaderboardData()
      setAuthLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [loadUserAnalytics, loadLeaderboardData])

  // 5. Supabase Realtime Presence
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase.channel('stoody-live-presence', {
      config: { presence: { key: user.id } }
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
            userId: user.id,
            name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Student',
            isStudying: isRunning && (engineMode !== 'pomodoro' || pomoPhase === 'work'),
            subject: subject,
            startedAt: isRunning ? Date.now() : undefined
          })
        }
      })

    presenceChannelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [user, isRunning, subject, engineMode, pomoPhase])

  // 6. Mutex-Guarded Automated Session Logger
  const autoLogSession = useCallback(async (durationMinutes: number) => {
    if (durationMinutes <= 0 || !user?.id || isSavingRef.current) return

    isSavingRef.current = true
    setSaveStatus('Saving session...')
    
    try {
      const { error } = await supabase.from('study_sessions').insert({
        user_id: user.id,
        duration_minutes: durationMinutes,
        subject: subject || 'General',
        mode: engineMode,
      })

      if (!error) {
        setSaveStatus(`Logged ${durationMinutes}m automatically!`)
        await loadUserAnalytics(user.id)
        setTimeout(() => setSaveStatus(''), 4000)
      } else {
        setSaveStatus('Failed to sync session')
      }
    } finally {
      setTimeout(() => {
        isSavingRef.current = false
      }, 400)
    }
  }, [user, subject, engineMode, loadUserAnalytics])

  // 7. Flush Active Study Session Delta (Prevents Double Count Glitch)
  const flushCurrentSessionDelta = useCallback(() => {
    if (!activeRunStartRef.current) return
    const elapsedMs = Date.now() - activeRunStartRef.current
    activeRunStartRef.current = null // Nullify immediately to reject second click

    const elapsedMinutes = Math.floor(elapsedMs / 60000)
    if (elapsedMinutes >= 1) {
      autoLogSession(elapsedMinutes)
    }
  }, [autoLogSession])

  // 8. Advance Pomodoro Phase on Normal Timer Expiration
  const handlePomodoroCompletion = useCallback(() => {
    playCompletionChime()
    activeRunStartRef.current = null

    if (pomoPhase === 'work') {
      autoLogSession(25)

      if (pomoRound >= 4) {
        setPomoPhase('longBreak')
        setTimeLeft(15 * 60)
        setPomoRound(1)
        setSaveStatus('Completed 4 rounds! 15m Long Break.')
      } else {
        setPomoPhase('shortBreak')
        setTimeLeft(5 * 60)
        setSaveStatus(`Round ${pomoRound} complete! 5m Short Break.`)
      }
    } else {
      if (pomoPhase === 'shortBreak') {
        setPomoRound((prev) => prev + 1)
      }
      setPomoPhase('work')
      setTimeLeft(25 * 60)
      setSaveStatus(`Break over! Ready for Round ${pomoPhase === 'shortBreak' ? pomoRound + 1 : 1}.`)
    }

    setIsRunning(false)
    targetEndRef.current = null
  }, [pomoPhase, pomoRound, autoLogSession, playCompletionChime])

  // 9. Skip Handler: Advances state WITHOUT logging unearned minutes
  const skipPomodoroPhase = () => {
    activeRunStartRef.current = null
    setIsRunning(false)
    targetEndRef.current = null

    if (pomoPhase === 'work') {
      if (pomoRound >= 4) {
        setPomoPhase('longBreak')
        setTimeLeft(15 * 60)
        setPomoRound(1)
        setSaveStatus('Skipped to Long Break.')
      } else {
        setPomoPhase('shortBreak')
        setTimeLeft(5 * 60)
        setSaveStatus(`Skipped to Break (${pomoRound}/4).`)
      }
    } else {
      if (pomoPhase === 'shortBreak') {
        setPomoRound((prev) => prev + 1)
      }
      setPomoPhase('work')
      setTimeLeft(25 * 60)
      setSaveStatus(`Skipped break. Staged Round ${pomoPhase === 'shortBreak' ? pomoRound + 1 : 1}.`)
    }
  }

  // 10. Synchronize display inputs with timeLeft
  useEffect(() => {
    if (engineMode !== 'stopwatch') {
      const mins = Math.floor(timeLeft / 60)
      const secs = timeLeft % 60
      setInputMins(String(mins).padStart(2, '0'))
      setInputSecs(String(secs).padStart(2, '0'))
    }
  }, [timeLeft, engineMode])

  // 11. Manual Digit Editing
  const handleMinuteInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (engineMode === 'pomodoro') return
    const val = e.target.value.replace(/\D/g, '').slice(0, 3)
    setInputMins(val)
    const numericMinutes = parseInt(val || '0', 10)
    const numericSeconds = parseInt(inputSecs || '0', 10)
    const newTotal = numericMinutes * 60 + numericSeconds
    setTimeLeft(newTotal)
    setCustomMinutes(Math.max(1, Math.round(newTotal / 60)))
  }

  const handleSecondInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (engineMode === 'pomodoro') return
    const val = e.target.value.replace(/\D/g, '').slice(0, 2)
    const clamped = Math.min(59, parseInt(val || '0', 10))
    setInputSecs(String(clamped).padStart(2, '0'))
    const numericMinutes = parseInt(inputMins || '0', 10)
    const newTotal = numericMinutes * 60 + clamped
    setTimeLeft(newTotal)
    setCustomMinutes(Math.max(1, Math.round(newTotal / 60)))
  }

  // 12. Switch Engine Modes
  const switchEngineMode = (newMode: EngineMode) => {
    if (isRunning) {
      flushCurrentSessionDelta()
    }
    setIsRunning(false)
    targetEndRef.current = null
    stopwatchStartRef.current = null
    activeRunStartRef.current = null
    setEngineMode(newMode)

    if (newMode === 'pomodoro') {
      setPomoPhase('work')
      setPomoRound(1)
      setTimeLeft(25 * 60)
    } else if (newMode === 'timer') {
      setTimeLeft(customMinutes * 60)
    } else if (newMode === 'stopwatch') {
      setStopwatchElapsed(0)
    }
  }

  // 13. Timestamp-Driven Ticking Loop
  useEffect(() => {
    if (isRunning) {
      if (engineMode === 'stopwatch') {
        stopwatchStartRef.current = Date.now() - stopwatchElapsed * 1000
      } else {
        targetEndRef.current = Date.now() + timeLeft * 1000
      }

      timerRef.current = setInterval(() => {
        if (engineMode === 'stopwatch') {
          if (stopwatchStartRef.current) {
            const elapsed = Math.floor((Date.now() - stopwatchStartRef.current) / 1000)
            setStopwatchElapsed(elapsed)
          }
        } else {
          if (targetEndRef.current) {
            const remaining = Math.max(0, Math.ceil((targetEndRef.current - Date.now()) / 1000))
            setTimeLeft(remaining)

            if (remaining <= 0) {
              clearInterval(timerRef.current!)
              if (engineMode === 'pomodoro') {
                handlePomodoroCompletion()
              } else {
                setIsRunning(false)
                targetEndRef.current = null
                activeRunStartRef.current = null
                playCompletionChime()
                autoLogSession(customMinutes)
              }
            }
          }
        }
      }, 250)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      targetEndRef.current = null
      stopwatchStartRef.current = null
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRunning, engineMode, customMinutes, timeLeft, stopwatchElapsed, autoLogSession, handlePomodoroCompletion, playCompletionChime])

  // 14. Glitch-Proof Toggle Timer
  const toggleTimer = () => {
    if (isRunning) {
      // Transitioning to Paused: save delta and lock
      if (engineMode === 'stopwatch') {
        const mins = Math.round(stopwatchElapsed / 60)
        if (mins >= 1) autoLogSession(mins)
      } else if (engineMode === 'timer' || (engineMode === 'pomodoro' && pomoPhase === 'work')) {
        flushCurrentSessionDelta()
      }
      setIsRunning(false)
    } else {
      // Transitioning to Running: stamp start time
      activeRunStartRef.current = Date.now()
      setIsRunning(true)
    }
  }

  const resetTimer = () => {
    if (isRunning) {
      flushCurrentSessionDelta()
    }
    setIsRunning(false)
    targetEndRef.current = null
    stopwatchStartRef.current = null
    activeRunStartRef.current = null
    
    if (engineMode === 'stopwatch') {
      setStopwatchElapsed(0)
    } else if (engineMode === 'pomodoro') {
      if (pomoPhase === 'work') setTimeLeft(25 * 60)
      else if (pomoPhase === 'shortBreak') setTimeLeft(5 * 60)
      else setTimeLeft(15 * 60)
    } else {
      setTimeLeft(customMinutes * 60)
    }
  }

  const handleGoogleLogin = () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  // 15. Rolling Heat Map
  const heatMapDays = useMemo(() => {
    const days: HeatMapDay[] = []
    const totalWeeks = 20
    const today = new Date()
    const todayKey = today.toISOString().split('T')[0]
    const dayOfWeek = today.getDay()
    const totalDays = totalWeeks * 7 + (dayOfWeek + 1)
    
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(today.getDate() - i)
      const dateKey = d.toISOString().split('T')[0]
      const mins = analyticsData.dailyBreakdown[dateKey] || 0
      const isToday = dateKey === todayKey

      let level = 0
      if (mins > 0 && mins <= 30) level = 1
      else if (mins > 30 && mins <= 60) level = 2
      else if (mins > 60 && mins <= 120) level = 3
      else if (mins > 120) level = 4

      days.push({
        dateKey,
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        minutes: mins,
        level,
        isToday
      })
    }
    return days
  }, [analyticsData.dailyBreakdown])

  // 16. 14-Day Spline Curve
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

  const maxBarHours = useMemo(() => {
    const max = Math.max(...analyticsData.sevenDayBars.map(b => b.hours), 1)
    return Math.ceil(max)
  }, [analyticsData.sevenDayBars])

  const todayTotalMinutes = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0]
    return analyticsData.dailyBreakdown[todayStr] || 0
  }, [analyticsData.dailyBreakdown])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center text-zinc-400">
        <div className="w-8 h-8 border-2 border-purple-500/20 border-t-purple-500 rounded-full animate-spin mb-4" />
        <p className="text-xs font-mono tracking-wider text-zinc-500">AUTHENTICATING...</p>
      </div>
    )
  }

  // DIRECTION 3: MINIMALIST LANDING CARD
  if (!user) {
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col items-center justify-center p-6 selection:bg-purple-600/30 relative overflow-hidden">
        <div className="absolute w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none -top-20" />
        
        <div className="max-w-md w-full bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-8 backdrop-blur-2xl shadow-2xl relative z-10 space-y-7">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="relative">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 opacity-30 blur-md" />
              <div className="relative w-12 h-12 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-center font-bold text-lg text-purple-400">
                S
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Stoody</h1>
              <p className="text-xs text-zinc-400 mt-1">Your personal study hub & live accountability tracker.</p>
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-950/50 border border-zinc-800/50">
              <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400 shrink-0">
                <Flame className="w-4 h-4 fill-orange-500/20" />
              </div>
              <div className="text-left">
                <div className="text-xs font-semibold text-zinc-200">Pomodoro Intervals & Streaks</div>
                <div className="text-[11px] text-zinc-500">Focus cycles automatically sync to your cloud streak</div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-950/50 border border-zinc-800/50">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                <Users className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="text-xs font-semibold text-zinc-200">Real-Time Presence</div>
                <div className="text-[11px] text-zinc-500">See when your friends are live in active focus</div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-950/50 border border-zinc-800/50">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="text-xs font-semibold text-zinc-200">Rolling Heat Maps</div>
                <div className="text-[11px] text-zinc-500">Clean contribution grid tracking your consistency</div>
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-1">
            <button
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-white hover:bg-zinc-100 text-zinc-950 font-semibold text-xs tracking-wide transition shadow-lg shadow-white/5 active:scale-[0.98]"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/>
                <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.3-6.7-5.3L1.6 16c1.9 3.8 5.8 7 10.4 7z"/>
                <path fill="#FBBC05" d="M5.3 14.7c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.6 7.2C.6 9.2 0 11.5 0 14s.6 4.8 1.6 6.8l3.7-2.9z"/>
                <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.3 8.9 5 12 5z"/>
              </svg>
              Continue with Google
            </button>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Signed in once, remembered automatically</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans selection:bg-purple-600/30">
      <style jsx global>{`
        @keyframes calmBreath {
          0%, 100% {
            transform: scale(0.9);
            opacity: 0.18;
          }
          50% {
            transform: scale(1.22);
            opacity: 0.45;
          }
        }
        .animate-calm-breath {
          animation: calmBreath 4.2s ease-in-out infinite;
        }
      `}</style>

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
                    <span className="text-xl font-bold text-white">{analyticsData.currentStreak} Days</span>
                    <span className="text-xs bg-orange-500/20 text-orange-300 font-medium px-2 py-0.5 rounded-full border border-orange-500/30">
                      Active Streak
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">Consecutive daily study streak synced with leaderboard.</p>
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
              
              {/* Dynamic Ambient Glow */}
              {isBreakActive ? (
                <div className="absolute w-80 h-80 bg-emerald-500/30 rounded-full blur-3xl pointer-events-none animate-calm-breath transition-all duration-1000" />
              ) : (
                <div className="absolute w-72 h-72 bg-purple-600/10 rounded-full blur-3xl pointer-events-none transition-all duration-700" />
              )}

              {/* Engine Switcher */}
              <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 bg-zinc-900/80 rounded-2xl border border-zinc-800/90 mb-6 z-10">
                <button
                  onClick={() => switchEngineMode('pomodoro')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    engineMode === 'pomodoro' 
                      ? isBreakActive ? 'bg-emerald-600 text-white shadow-md' : 'bg-purple-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" /> Pomodoro Cycle
                </button>
                <button
                  onClick={() => switchEngineMode('timer')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    engineMode === 'timer' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Hourglass className="w-3.5 h-3.5" /> Timer
                </button>
                <button
                  onClick={() => switchEngineMode('stopwatch')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    engineMode === 'stopwatch' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Watch className="w-3.5 h-3.5" /> Stopwatch
                </button>
              </div>

              {/* Pomodoro Round Indicator & Phase Pill */}
              {engineMode === 'pomodoro' && (
                <div className="flex items-center gap-3 mb-6 z-10">
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                    isBreakActive 
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400' 
                      : 'bg-zinc-900/90 border-zinc-800 text-zinc-300'
                  }`}>
                    {pomoPhase === 'work' && <span className="text-purple-400 font-semibold">Focus Block</span>}
                    {pomoPhase === 'shortBreak' && <span className="text-emerald-400 font-semibold flex items-center gap-1.5"><Coffee className="w-3 h-3" /> Short Break</span>}
                    {pomoPhase === 'longBreak' && <span className="text-emerald-400 font-semibold flex items-center gap-1.5"><Coffee className="w-3 h-3" /> Long Break</span>}
                  </div>

                  {/* 4 Round Dots */}
                  <div className="flex items-center gap-1.5 bg-zinc-900/90 border border-zinc-800 px-3 py-1.5 rounded-full">
                    {[1, 2, 3, 4].map((dot) => (
                      <div
                        key={dot}
                        className={`w-2 h-2 rounded-full transition-all ${
                          dot < pomoRound || (dot === pomoRound && pomoPhase !== 'work')
                            ? isBreakActive ? 'bg-emerald-500 ring-2 ring-emerald-500/30' : 'bg-purple-500 ring-2 ring-purple-500/30'
                            : dot === pomoRound
                            ? isBreakActive ? 'bg-emerald-400 animate-pulse' : 'bg-purple-400 animate-pulse'
                            : 'bg-zinc-700'
                        }`}
                        title={`Round ${dot} of 4`}
                      />
                    ))}
                    <span className="text-[10px] text-zinc-400 font-mono ml-1">R{pomoRound}/4</span>
                  </div>
                </div>
              )}

              {/* Big Timer Digits */}
              <div className={`text-7xl md:text-8xl font-black tracking-tight mb-6 tabular-nums select-none z-10 font-mono transition-colors duration-500 ${
                isBreakActive ? 'text-emerald-100' : 'text-white'
              }`}>
                {engineMode === 'stopwatch' ? (
                  <span>{formatTime(stopwatchElapsed)}</span>
                ) : (
                  <div className="flex items-center justify-center">
                    <input
                      type="text"
                      disabled={isRunning || engineMode === 'pomodoro'}
                      value={inputMins}
                      onChange={handleMinuteInput}
                      title={engineMode === 'pomodoro' ? 'Pomodoro sets duration automatically' : isRunning ? 'Pause to edit' : 'Type minutes'}
                      className={`w-28 md:w-36 text-right bg-transparent border-b-2 border-transparent transition selection:bg-purple-600/40 ${
                        engineMode === 'pomodoro' ? 'cursor-default' : 'hover:border-zinc-700 focus:border-purple-500 focus:outline-none cursor-pointer'
                      }`}
                    />
                    <span className={`mx-1 ${isBreakActive ? 'text-emerald-500/60' : 'text-zinc-500'}`}>:</span>
                    <input
                      type="text"
                      disabled={isRunning || engineMode === 'pomodoro'}
                      value={inputSecs}
                      onChange={handleSecondInput}
                      title={engineMode === 'pomodoro' ? 'Pomodoro sets duration automatically' : isRunning ? 'Pause to edit' : 'Type seconds'}
                      className={`w-28 md:w-36 text-left bg-transparent border-b-2 border-transparent transition selection:bg-purple-600/40 ${
                        engineMode === 'pomodoro' ? 'cursor-default' : 'hover:border-zinc-700 focus:border-purple-500 focus:outline-none cursor-pointer'
                      }`}
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
                  className={`flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-sm transition active:scale-95 ${
                    isBreakActive
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/25'
                      : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/25'
                  }`}
                >
                  {isRunning ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white" />}
                  {isRunning ? 'Pause & Auto-Save' : isBreakActive ? 'Start Break' : 'Start Focus'}
                </button>

                {engineMode === 'pomodoro' && (
                  <button
                    onClick={skipPomodoroPhase}
                    className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 transition"
                    title="Skip to next phase without logging"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                )}

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
            {/* Metric Overview Cards */}
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
                <div className="text-zinc-500 text-xs flex items-center gap-1.5 mb-1"><Flame className="w-3.5 h-3.5 text-orange-400" /> Active Streak</div>
                <div className="text-2xl font-bold text-white">{analyticsData.currentStreak} Days</div>
                <div className="text-zinc-500 text-[11px] mt-1">Daily consistency</div>
              </div>

              <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-4">
                <div className="text-zinc-500 text-xs flex items-center gap-1.5 mb-1"><Calendar className="w-3.5 h-3.5" /> Total Sessions</div>
                <div className="text-2xl font-bold text-white">{analyticsData.sessionCount}</div>
                <div className="text-zinc-500 text-[11px] mt-1">Completed blocks</div>
              </div>
            </div>

            {/* Today at a Glance + 7-Day Bar Chart Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Card 1: Today at a Glance */}
              <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-base font-semibold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" /> Today at a Glance
                    </h3>
                    <span className="text-xs font-mono text-purple-400 bg-purple-950/40 border border-purple-800/50 px-2.5 py-1 rounded-lg">
                      {Math.floor(todayTotalMinutes / 60)}h {todayTotalMinutes % 60}m logged
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">Hourly focus distribution over today&apos;s 24-hour cycle.</p>
                </div>

                {/* 24-Hour Timeline Matrix */}
                <div className="py-6 space-y-3">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                    <span className="flex items-center gap-1"><Moon className="w-3 h-3" /> 12 AM</span>
                    <span className="flex items-center gap-1"><Sun className="w-3 h-3" /> 12 PM</span>
                    <span className="flex items-center gap-1"><Moon className="w-3 h-3" /> 11 PM</span>
                  </div>

                  <div className="grid grid-cols-24 gap-1 h-12 items-end bg-zinc-950/50 p-1.5 rounded-xl border border-zinc-800/60">
                    {analyticsData.todayHoursDistribution.map((mins, hr) => {
                      const heightPercent = mins > 0 ? Math.min(100, Math.max(25, (mins / 60) * 100)) : 8
                      return (
                        <div
                          key={hr}
                          className="h-full flex flex-col justify-end group relative cursor-pointer"
                        >
                          <div
                            style={{ height: `${heightPercent}%` }}
                            className={`w-full rounded-sm transition-all duration-300 ${
                              mins > 0
                                ? 'bg-purple-500 group-hover:bg-purple-400 group-hover:scale-110 shadow-sm shadow-purple-500/50'
                                : 'bg-zinc-800/60 group-hover:bg-zinc-700'
                            }`}
                          />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex flex-col items-center pointer-events-none z-30">
                            <div className="bg-zinc-900 border border-zinc-700 text-white text-[10px] py-1 px-2 rounded-md shadow-xl whitespace-nowrap font-mono">
                              {hr % 12 === 0 ? 12 : hr % 12} {hr >= 12 ? 'PM' : 'AM'}: {mins}m
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-2 border-t border-zinc-800/40">
                  <span>Tracked from real-time session logs</span>
                  <span className="text-zinc-400 font-medium">Reset at midnight</span>
                </div>
              </div>

              {/* Card 2: Interactive 7-Day Bar Chart */}
              <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-6 relative flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-base font-semibold text-white flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-purple-400" /> Past 7 Days
                    </h3>
                    <span className="text-xs text-zinc-400 font-mono">Peak: {maxBarHours}h</span>
                  </div>
                  <p className="text-xs text-zinc-400">Hover over any day bar for exact hours and session minutes.</p>
                </div>

                {/* Bars Container */}
                <div className="py-4 relative">
                  {hoveredBar && (
                    <div className="absolute top-0 right-4 bg-zinc-900/90 border border-purple-500/40 px-3 py-1 rounded-lg text-xs font-mono text-purple-300 shadow-xl backdrop-blur-md animate-in fade-in">
                      {hoveredBar.dayLabel}: <span className="font-bold text-white">{hoveredBar.hours} hrs</span> ({hoveredBar.minutes} mins)
                    </div>
                  )}

                  <div className="h-36 flex items-end justify-between gap-3 pt-6 px-2">
                    {analyticsData.sevenDayBars.map((bar, i) => {
                      const barFillPercent = Math.min(100, Math.max(6, (bar.hours / maxBarHours) * 100))
                      return (
                        <div
                          key={i}
                          onMouseEnter={() => setHoveredBar(bar)}
                          onMouseLeave={() => setHoveredBar(null)}
                          className="flex-1 flex flex-col items-center gap-2 h-full justify-end cursor-pointer group"
                        >
                          <div className="w-full relative flex items-end justify-center h-full">
                            <div
                              style={{ height: `${barFillPercent}%` }}
                              className={`w-full max-w-[36px] rounded-t-xl transition-all duration-500 ease-out group-hover:scale-y-105 group-hover:brightness-125 ${
                                bar.isToday
                                  ? 'bg-gradient-to-t from-purple-700 to-purple-400 ring-2 ring-purple-400/40 shadow-lg shadow-purple-600/30'
                                  : bar.minutes > 0
                                  ? 'bg-gradient-to-t from-purple-900/80 to-purple-600'
                                  : 'bg-zinc-800/60'
                              }`}
                            />
                          </div>
                          <span className={`text-[11px] font-mono transition ${
                            bar.isToday ? 'text-purple-300 font-bold' : 'text-zinc-500 group-hover:text-zinc-300'
                          }`}>
                            {bar.dayLabel}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-2 border-t border-zinc-800/40">
                  <span>Interactive day analytics</span>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                    <span>Focus Hours</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Study Activity Curve */}
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-6 relative">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-white">Study Activity</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Daily focus trend over the last 14 days</p>
                </div>
                <div className="flex gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800 text-[11px]">
                  <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-white font-medium">14D</span>
                </div>
              </div>
              
              <div className="h-48 w-full pt-4 relative">
                {hoveredPoint && (
                  <div
                    className="absolute z-20 pointer-events-none transform -translate-x-1/2 -translate-y-full mb-2 bg-zinc-900 border border-purple-500/40 shadow-xl px-3 py-1.5 rounded-lg text-center backdrop-blur-md"
                    style={{ left: `${(hoveredPoint.x / 500) * 100}%`, top: `${(hoveredPoint.y / 120) * 100}%` }}
                  >
                    <div className="text-[10px] text-zinc-400 font-mono">{hoveredPoint.label}</div>
                    <div className="text-xs font-bold text-purple-300">
                      {Math.floor(hoveredPoint.hours)}h {Math.round((hoveredPoint.hours % 1) * 60)}m
                    </div>
                  </div>
                )}

                {analyticsData.splinePoints.length > 0 ? (
                  <svg viewBox="0 0 500 120" className="w-full h-full overflow-visible">
                    <defs>
                      <linearGradient id="purpleGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity="0.3" />
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
                      return (
                        <g key={idx} className="cursor-pointer">
                          <circle
                            cx={cx}
                            cy={cy}
                            r="14"
                            fill="transparent"
                            onMouseEnter={() => setHoveredPoint({ ...p, x: cx, y: cy })}
                            onMouseLeave={() => setHoveredPoint(null)}
                          />
                          <circle
                            cx={cx}
                            cy={cy}
                            r={hoveredPoint?.dateKey === p.dateKey ? "6" : "4"}
                            fill={hoveredPoint?.dateKey === p.dateKey ? "#e9d5ff" : "#c084fc"}
                            stroke="#6b21a8"
                            strokeWidth={hoveredPoint?.dateKey === p.dateKey ? "2" : "1"}
                            className="transition-all duration-150 pointer-events-none"
                          />
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

            {/* Rolling Heat Map */}
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-white">Study Heat Map</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {Math.floor(analyticsData.totalMinutes / 60)}h {Math.round(analyticsData.totalMinutes % 60)}m logged across {analyticsData.activeDaysCount} active days
                  </p>
                </div>
                <div className="text-xs text-zinc-400 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800 font-mono">
                  Rolling 20 Weeks
                </div>
              </div>
              
              <div className="w-full flex justify-center py-2">
                <div className="flex gap-2">
                  <div className="grid grid-rows-7 gap-1.5 text-[9px] text-zinc-500 font-mono select-none h-max">
                    <span className="h-3.5 flex items-center">Sun</span>
                    <span className="h-3.5 flex items-center">Mon</span>
                    <span className="h-3.5 flex items-center">Tue</span>
                    <span className="h-3.5 flex items-center">Wed</span>
                    <span className="h-3.5 flex items-center">Thu</span>
                    <span className="h-3.5 flex items-center">Fri</span>
                    <span className="h-3.5 flex items-center">Sat</span>
                  </div>

                  <div className="grid grid-flow-col grid-rows-7 gap-1.5">
                    {heatMapDays.map((day, i) => {
                      const colorClasses = [
                        'bg-zinc-900 hover:bg-zinc-800 border border-zinc-800/60',
                        'bg-emerald-950 border border-emerald-900',
                        'bg-emerald-800',
                        'bg-emerald-600',
                        'bg-emerald-400 ring-2 ring-emerald-300/40',
                      ]
                      return (
                        <div
                          key={i}
                          onMouseEnter={() => setHoveredHeatDay(day)}
                          onMouseLeave={() => setHoveredHeatDay(null)}
                          className={`w-3.5 h-3.5 rounded-[3px] transition cursor-pointer hover:scale-125 ${
                            day.isToday ? 'ring-1 ring-white/60' : ''
                          } ${colorClasses[day.level]}`}
                        />
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-500 mt-3 pt-3 border-t border-zinc-800/50">
                <span className="font-mono text-zinc-400">
                  {hoveredHeatDay ? `${hoveredHeatDay.label}: ${hoveredHeatDay.minutes}m focus time` : 'Hover a cell to see day stats'}
                </span>
                <div className="flex items-center gap-1.5">
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

            {/* Recent Sessions Activity Feed */}
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-3xl p-6">
              <h3 className="text-base font-semibold text-white mb-4">Recent Sessions</h3>
              <div className="divide-y divide-zinc-800/60">
                {analyticsData.recentSessions.length > 0 ? (
                  analyticsData.recentSessions.map((session) => (
                    <div key={session.id} className="py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                          <Clock className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">{session.subject || 'General'}</div>
                          <div className="text-[11px] text-zinc-500 capitalize">{session.mode || 'Focus block'}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-purple-400">+{session.duration_minutes}m</div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          {new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center text-xs text-zinc-500">
                    No sessions logged yet today. Complete a focus block to see it appear here!
                  </div>
                )}
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
              {leaderboardUsers
                .slice()
                .sort((a, b) => activeLeaderboardTab === 'weekly' ? b.total_minutes - a.total_minutes : b.streak - a.streak)
                .map((lbUser, index) => {
                  const presence = onlineUsers[lbUser.id]
                  const isCurrent = user?.id === lbUser.id
                  const isOnline = Boolean(presence)
                  const studyingNow = presence?.isStudying ?? (isCurrent && isRunning && (engineMode !== 'pomodoro' || pomoPhase === 'work'))
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