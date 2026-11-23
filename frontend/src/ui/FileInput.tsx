import { useState } from 'react'
import { Upload } from 'lucide-react'

// Keep the native input for keyboard access and FormData, style only its visible label.
export function FileInput({ label, name, accept }: { label: string; name: string; accept: string }) {
  const [filename, setFilename] = useState('')
  return <label className="org-field file-field"><span>{label}</span>
    <span className="file-control"><span className="file-control-button"><Upload size={16} aria-hidden="true" />Fotó kiválasztása
      <input type="file" name={name} accept={accept} aria-label={label} onChange={event => setFilename(event.target.files?.[0]?.name ?? '')} />
    </span><span className="file-control-name" title={filename}>{filename || 'Nincs kiválasztva'}</span></span>
  </label>
}
