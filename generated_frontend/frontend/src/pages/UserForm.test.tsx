
import { render, screen, fireEvent, waitFor } from '@/lib/test-utils'
import { UserForm } from './UserForm'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as queries from '@/lib/queries'
import { useParams, useNavigate } from 'react-router-dom'
import userEvent from '@testing-library/user-event'

// Mock queries and router
vi.mock('@/lib/queries', () => ({
    useUser: vi.fn(),
    useCreateUser: vi.fn(),
    useUpdateUser: vi.fn(),
    
}))

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom')
    return {
        ...actual,
        useParams: vi.fn(),
        useNavigate: vi.fn()
    }
})

describe('UserForm', () => {
    const mockNavigate = vi.fn()
    const mockCreate = vi.fn()
    const mockUpdate = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(useNavigate).mockReturnValue(mockNavigate)
        vi.mocked(queries.useCreateUser).mockReturnValue({ mutate: mockCreate, isPending: false } as any)
        vi.mocked(queries.useUpdateUser).mockReturnValue({ mutate: mockUpdate, isPending: false } as any)
        
        // Mock relations if any
        
    })

    it('renders create form', () => {
        vi.mocked(useParams).mockReturnValue({}) // No ID = Create mode
        vi.mocked(queries.useUser).mockReturnValue({ data: null, isLoading: false } as any)

        render(<UserForm />)
        expect(screen.getByText('Create User')).toBeInTheDocument()
    })

    it('renders edit form with data', () => {
        const mockData = { id: '1', name: 'Edit Item' }
        vi.mocked(useParams).mockReturnValue({ id: '1' })
        vi.mocked(queries.useUser).mockReturnValue({ data: mockData, isLoading: false } as any)

        render(<UserForm />)
        expect(screen.getByText('Edit User')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Edit Item')).toBeInTheDocument()
    })
})
