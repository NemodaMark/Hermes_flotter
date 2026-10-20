import { useEffect, useState } from 'react'
import { request } from './api'

export function ProtectedImage({ path, tenantId, revision, alt, className = '', fallback = '?' }: {
  path: string; tenantId?: string; revision?: string | null; alt: string; className?: string; fallback?: string
}) {
  const key = `${tenantId ?? ''}:${path}:${revision ?? ''}`
  const [image, setImage] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!revision) return
    const controller = new AbortController()
    let url: string | undefined
    void request<Blob>(path, { tenantId, signal: controller.signal, responseType: 'blob' }).then(blob => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      setImage({ key, url })
    }).catch(() => { /* The initials remain visible when a photo is absent or access has changed. */ })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [key, path, tenantId, revision])
  return image?.key === key ? <img src={image.url} className={className} alt={alt} /> : <span className={`${className} image-fallback`} role="img" aria-label={alt}>{fallback}</span>
}
