'use client'

import { Input } from '@/components/ui/primitives/input'
import { useCallback, useEffect, useRef, useState } from 'react'
import { debounce } from '../lib/debounce'

export function DebouncedInput({
  value: initialValue,
  onChange,
  debounceMs = 500, // This is the wait time, not the function
  ...props
}: {
  value: string | number
  onChange: (value: string | number) => void
  debounceMs?: number
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  const [value, setValue] = useState(initialValue)

  // Sync with initialValue when it changes
  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  // Keep the debounced invoker in a ref so the callback identity stays stable
  // (an inline wrapper keeps the exhaustive-deps rule satisfied).
  const debouncedRef = useRef(
    debounce((newValue: string | number) => {
      onChange(newValue)
    }, debounceMs),
  )

  useEffect(() => {
    debouncedRef.current = debounce((newValue: string | number) => {
      onChange(newValue)
    }, debounceMs)
  }, [debounceMs, onChange])

  const debouncedOnChange = useCallback((newValue: string | number) => {
    debouncedRef.current(newValue)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setValue(newValue) // Update local state immediately
    debouncedOnChange(newValue) // Call debounced version
  }

  return <Input {...props} value={value} onChange={handleChange} />
}
