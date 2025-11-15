model User {
  id: uuid pk
  tenantId: uuid tenant
  email: string
  role: string
}

policy User.read {
  ({ user, record }) => record.tenantId === user.tenantId
}
