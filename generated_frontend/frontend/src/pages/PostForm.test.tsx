
import { render, screen, fireEvent, waitFor } from '@/lib/test-utils'
import { PostForm } from './PostForm'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as queries from '@/lib/queries'
import { useParams, useNavigate } from 'react-router-dom'
import userEvent from '@testing-library/user-event'

// Mock queries and router
vi.mock('@/lib/queries', () => ({
    usePost: vi.fn(),
    useCreatePost: vi.fn(),
    useUpdatePost: vi.fn(),
    useUsers: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom')
    return {
        ...actual,
        useParams: vi.fn(),
        useNavigate: vi.fn()
    }
})

describe('PostForm', () => {
    const mockNavigate = vi.fn()
    const mockCreate = vi.fn()
    const mockUpdate = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(useNavigate).mockReturnValue(mockNavigate)
        vi.mocked(queries.useCreatePost).mockReturnValue({ mutate: mockCreate, isPending: false } as any)
        vi.mocked(queries.useUpdatePost).mockReturnValue({ mutate: mockUpdate, isPending: false } as any)
        
        // Mock relations if any
        
        vi.mocked(queries.useUsers).mockReturnValue({ 
            data: [{ id: '1', title: 'Related Item' }], 
            isLoading: false 
        } as any)
        
    })

    it('renders create form', () => {
        vi.mocked(useParams).mockReturnValue({}) // No ID = Create mode
        vi.mocked(queries.usePost).mockReturnValue({ data: null, isLoading: false } as any)

        render(<PostForm />)
        expect(screen.getByText('Create Post')).toBeInTheDocument()
    })

    it('renders edit form with data', () => {
        const mockData = { id: '1', title: 'Edit Item' }
        vi.mocked(useParams).mockReturnValue({ id: '1' })
        vi.mocked(queries.usePost).mockReturnValue({ data: mockData, isLoading: false } as any)

        render(<PostForm />)
        expect(screen.getByText('Edit Post')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Edit Item')).toBeInTheDocument()
    })
})
