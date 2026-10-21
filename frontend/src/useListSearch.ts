import { useEffect, useState } from 'react'

// Commit the query and first page together; intermediate keystrokes never fetch a stale page.
export function useListSearch() {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState({ search: '', page: 1 })
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const search = draft.trim()
      setQuery(current => current.search === search ? current : { search, page: 1 })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [draft])
  return { ...query, draft, setDraft, setPage: (page: number) => setQuery(current => ({ ...current, page })) }
}
