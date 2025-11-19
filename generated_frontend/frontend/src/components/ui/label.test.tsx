
import { render, screen } from '@/lib/test-utils'
import { Label } from './label'
import { describe, it, expect } from 'vitest'

describe('Label', () => {
    it('renders correctly', () => {
        render(<Label htmlFor="test-input">Test Label</Label>)
        expect(screen.getByText('Test Label')).toBeInTheDocument()
    })
})
