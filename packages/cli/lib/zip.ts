import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import archiver from 'archiver'

export async function zipDirectories(directories: string[], zipPath?: string): Promise<string> {
  const dirs = directories
    .map(dir => path.resolve(dir))
    .filter(Boolean)

  if (!dirs.length) {
    throw new Error('No directories provided to zip.')
  }

  const archivePath =
    zipPath ||
    path.join(path.dirname(dirs[0]), `${path.basename(dirs[0])}-bundle.zip`)

  // remove existing archive so we don't append to stale data
  if (await fileExists(archivePath)) {
    await fsPromises.rm(archivePath, { force: true })
  }

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(archivePath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve())
    archive.on('error', (err: Error) => reject(err))

    archive.pipe(output)
    dirs.forEach(dir => {
      const dirName = path.basename(dir)
      archive.directory(dir, dirName)
    })
    archive.finalize()
  })

  return archivePath
}

export async function zipDirectory(sourceDir: string): Promise<string> {
  return zipDirectories([sourceDir])
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
}
