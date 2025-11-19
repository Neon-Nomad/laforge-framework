
import { render, screen, userEvent } from '@/lib/test-utils'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './select'
import { describe, it, expect } from 'vitest'

describe('Select', () => {
    it('renders correctly', () => {
        render(
            <Select>
                <SelectTrigger>
                    <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="opt1">Option 1</SelectItem>
                </SelectContent>
            </Select>
        )
        expect(screen.getByText('Select an option')).toBeInTheDocument()
    })
})
