import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  integer?: boolean
  disabled?: boolean
  onChange: (value: number) => void
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  integer = false,
  disabled,
  onChange,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value))
  const focusedRef = useRef(false)

  // Sincroniza el draft con el valor externo solo cuando el campo no está
  // enfocado, para no pisar lo que el usuario está escribiendo (p.ej. "2.").
  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value))
  }, [value])

  const handleChange = (raw: string) => {
    setDraft(raw)
    const number = Number(raw)
    if (
      raw !== "" &&
      Number.isFinite(number) &&
      number >= min &&
      number <= max &&
      (!integer || Number.isInteger(number))
    ) {
      onChange(number)
    }
  }

  const handleBlur = () => {
    focusedRef.current = false
    const number = Number(draft)
    if (draft === "" || !Number.isFinite(number)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, number))
    const final = integer ? Math.round(clamped) : clamped
    setDraft(String(final))
    onChange(final)
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <Input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={draft}
          disabled={disabled}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => {
            focusedRef.current = true
          }}
          onBlur={handleBlur}
          className={suffix ? "pr-12" : undefined}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}
