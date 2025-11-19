
import { render, screen, fireEvent } from '@/lib/test-utils'
import { UserList } from './UserList'
import { describe, it, expect, vi } from 'vitest'
import * as queries from '@/lib/queries'

// Mock the queries
vi.mock('@/lib/queries', () => ({
    useUsers: vi.fn(),
    useDeleteUser: vi.fn()
}))

describe('UserList', () => {
    it('renders loading state', () => {
        vi.mocked(queries.useUsers).mockReturnValue({
            data: undefined,
            isLoading: true,
            error: null
        } as any)

        render(<UserList />)
        expect(screen.getByText('Loading...')).toBeInTheDocument()
    })

    it('renders error state', () => {
        vi.mocked(queries.useUsers).mockReturnValue({
            data: undefined,
            isLoading: false,
            error: { message: 'Failed to fetch' }
        } as any)

        render(<UserList />)
        expect(screen.getByText('Error: Failed to fetch')).toBeInTheDocument()
    })

    it('renders list of items', () => {
        const mockData = [
            { id: '1', name: 'Test Item 1' },
            { id: '2', name: 'Test Item 2' }
        ]

        vi.mocked(queries.useUsers).mockReturnValue({
            data: mockData,
            isLoading: false,
            error: null
        } as any)

        vi.mocked(queries.useDeleteUser).mockReturnValue({
            mutate: vi.fn()
        } as any)

        render(<UserList />)
        expect(screen.getByText('Test Item 1')).toBeInTheDocument()
        expect(screen.getByText('Test Item 2')).toBeInTheDocument()
    })

    it('delete button triggers mutation', () => {
        const mockData = [{ id: '1', name: 'Test Item' }]
        const mockDelete = vi.fn()

        vi.mocked(queries.useUsers).mockReturnValue({
            data: mockData,
            isLoading: false,
            error: null
        } as any)

        vi.mocked(queries.useDeleteUser).mockReturnValue({
            mutate: mockDelete
        } as any)

        // Mock confirm
        global.confirm = vi.fn(() => true)

        render(<UserList />)
        
        const deleteBtn = screen.getByText('Delete')
        fireEvent.click(deleteBtn)

        expect(global.confirm).toHaveBeenCalled()
        expect(mockDelete).toHaveBeenCalledWith('1')
    })
})
