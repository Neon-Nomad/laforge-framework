-- Forge migration generated at Wed, 19 Nov 2025 00:16:19 GMT
CREATE TABLE IF NOT EXISTS users (
  id UUID NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(255) NOT NULL DEFAULT (,
  is_active BOOLEAN NOT NULL DEFAULT (true)
);
CREATE TABLE IF NOT EXISTS posts (
  id UUID NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT (false),
  author_id UUID NOT NULL
);
ALTER TABLE posts ADD CONSTRAINT fk_posts_author_id FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;
