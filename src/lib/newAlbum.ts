/**
 * Add Album creates the row at once, because the settings page (and uploads)
 * need a real album. The database requires a name, so the row is stored as
 * NEW_ALBUM_TITLE and the slug trigger names it `new-album-<id prefix>`. Until
 * the photographer saves a name, the settings form shows both fields blank and
 * fills the slug from the name as it is typed.
 */
export const NEW_ALBUM_TITLE = 'New album';

/**
 * Still the untouched placeholder from Add Album. Read from the saved row, not
 * page memory, so it survives a reload. An album deliberately saved as "New
 * album" gets the plain `new-album` slug (or a collision suffix that is not a
 * bare id prefix), so it is not mistaken for one.
 */
export function isUnnamedNewAlbum(album: { title: string; slug: string }): boolean {
  return album.title === NEW_ALBUM_TITLE && /^new-album-[0-9a-f]{6,8}$/.test(album.slug);
}
