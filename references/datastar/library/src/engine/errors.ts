import { snake } from '@utils/text'

const url = 'https://data-star.dev/errors'

export const createError = (
  ctx: Record<string, any>,
  reason: string,
  metadata: Record<string, any> = {},
): Error => {
  Object.assign(metadata, ctx)
  const r = snake(reason)
  const q = new URLSearchParams({
    metadata: JSON.stringify(metadata),
  }).toString()
  const c = JSON.stringify(metadata, null, 2)
  return new Error(`${reason}\nMore info: ${url}/${r}?${q}\nContext: ${c}`)
}
