import type { ReactNode } from 'react'
import { FieldSections } from './FieldSections'
import { VehicleDetailGroup } from './VehicleDetailGroup'

const sections = [
  { id: 'basic', label: 'Alapadatok' },
  { id: 'technical', label: 'Műszaki adatok' },
  { id: 'operation', label: 'Üzemeltetés' },
  { id: 'deadlines', label: 'Határidők és szerviz' },
] as const

export type VehicleFieldSection = typeof sections[number]['id']

export function VehicleFieldSections({ children, readOnly = false }: { children: Record<VehicleFieldSection, ReactNode>; readOnly?: boolean }) {
  if (readOnly) return <div className="vehicle-read-sections">{children.basic}{sections.slice(1).map(section =>
    <VehicleDetailGroup key={section.id} title={section.label}>{children[section.id]}</VehicleDetailGroup>)}</div>
  return <FieldSections label="Járműadatok mezőcsoportjai" sections={sections.map(section => ({ ...section, content: children[section.id] }))} />
}
