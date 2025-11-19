
import { render, screen, fireEvent } from '@/lib/test-utils'
import { PostDetail } from './PostDetail'
import { describe, it, expect, vi } from 'vitest'
import * as queries from '@/lib/queries'
import { useParams, useNavigate } from 'react-router-dom'

// Mock queries and router
vi.mock('@/lib/queries', () => ({
    usePost: vi.fn(),
    useDeletePost: vi.fn()
}))

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom')
    return {
        ...actual,
        useParams: vi.fn(),
        useNavigate: vi.fn()
    }
})

describe('PostDetail', () => {
    it('renders loading state', () => {
        vi.mocked(useParams).mockReturnValue({ id: '1' })
        vi.mocked(queries.usePost).mockReturnValue({
            data: undefined,
            isLoading: true,
            error: null
        } as any)

        render(<PostDetail />)
        expect(screen.getByText('Loading...')).toBeInTheDocument()
    })

    it('renders item details', () => {
        const mockItem = { id: '1', title: 'Detail Item' }
        vi.mocked(useParams).mockReturnValue({ id: '1' })
        vi.mocked(queries.usePost).mockReturnValue({
            data: mockItem,
            isLoading: false,
            error: null
        } as any)
        vi.mocked(queries.useDeletePost).mockReturnValue({ mutate: vi.fn() } as any)

        render(<PostDetail />)
        expect(screen.getByText('Detail Item')).toBeInTheDocument()
    })
})
