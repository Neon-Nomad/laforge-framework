// Demo blog domain for LaForge

model User {
  id: uuid pk
  tenantId: uuid tenant
  email: string
  name: string
  role: string
  posts: hasMany(Post)
}

model Post {
  id: uuid pk
  tenantId: uuid tenant
  title: string
  slug: string
  body: text
  published: boolean
  author: belongsTo(User)
}

model Comment {
  id: uuid pk
  tenantId: uuid tenant
  body: text
  author: belongsTo(User)
  post: belongsTo(Post)
}

policy User.read {
  ({ user, record }) => user.role === "admin" || record.id === user.id
}

policy User.update {
  ({ user }) => user.role === "admin"
}

policy Post.read {
  ({ user, record }) => record.published === true || record.tenantId === user.tenantId
}

policy Post.create {
  ({ user }) => user.role === "editor" || user.role === "admin"
}

policy Post.update {
  ({ user }) => user.role === "editor" || user.role === "admin"
}

policy Comment.create {
  ({ user, record }) => user.tenantId === record.tenantId
}

hook Post.beforeCreate {
  if (!record.slug && record.title) {
    record.slug = record.title.toLowerCase().replace(/\\s+/g, '-');
  }
}

extend Post.service {
  publish(postId) {
    return {
      ok: true,
      id: postId
    };
  }
}
