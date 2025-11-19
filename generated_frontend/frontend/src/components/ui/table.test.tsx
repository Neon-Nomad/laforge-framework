
import { render, screen } from '@/lib/test-utils'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table'
import { describe, it, expect } from 'vitest'

describe('Table', () => {
    it('renders correctly', () => {
        render(
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Header</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow>
                        <TableCell>Cell</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        )
        expect(screen.getByText('Header')).toBeInTheDocument()
        expect(screen.getByText('Cell')).toBeInTheDocument()
    })
})
