
import { render, screen } from '@/lib/test-utils'
import { Input } from './input'
import { describe, it, expect } from 'vitest'

describe('Input', () => {
    it('renders correctly', () => {
        render(<Input placeholder="Enter text" />)
        expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument()
    })

    it('applies custom classes', () => {
        render(<Input className="custom-class" data-testid="input" />)
        expect(screen.getByTestId('input')).toHaveClass('custom-class')
    })
})
