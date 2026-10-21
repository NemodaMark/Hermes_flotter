import type { ReactNode } from 'react'
import { FieldSections } from './FieldSections'

const sections = [
  { id: 'basic', label: 'Alapadatok' },
  { id: 'technical', label: 'Műszaki adatok' },
  { id: 'operation', label: 'Üzemeltetés' },
  { id: 'deadlines', label: 'Határidők és szerviz' },
] as const

export type VehicleFieldSection = typeof sections[number]['id']

export function VehicleFieldSections({ children }: { children: Record<VehicleFieldSection, ReactNode> }) {
  return <FieldSections label="Járműadatok mezőcsoportjai" sections={sections.map(section => ({ ...section, content: children[section.id] }))} />
}
