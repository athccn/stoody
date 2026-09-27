import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = 'https://dzhksfayrjonbeawvhox.supabase.co'
const supabaseAnonKey = 'sb_publishable_kDl6qKfPqutEWvbKKgsDSQ_oJ6GjXaw'

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)