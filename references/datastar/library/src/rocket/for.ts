import { genRx } from '@engine'
import { createError } from '@engine/errors'
import { effect, mergePaths, startPeeking, stopPeeking } from '@engine/signals'
import { rewriteDataAttributes, type TaggedLiteralScope } from './template'

type ForRow = {
  start: Comment
  end: Comment
  pathBase: string
  cleanups: Array<() => void>
}

const forControllerCleanups = new WeakMap<HTMLTemplateElement, () => void>()

let nextForControllerId = 0

const forError = (
  reason: string,
  template: HTMLTemplateElement,
  metadata: Record<string, any> = {},
): never => {
  throw createError(
    { element: { id: template.id, tag: template.tagName } },
    reason,
    metadata,
  )
}

// Give each `data-for` row a private signal scope so cloned content can be rewritten and independently removed as the iterable changes.
export const initRocketFors = (
  root: ParentNode,
  scope: TaggedLiteralScope,
  initNested: (
    root: ParentNode,
    scope: TaggedLiteralScope,
  ) => Array<() => void>,
) => {
  const cleanups: Array<() => void> = []
  const templates = [
    ...root.querySelectorAll<HTMLTemplateElement>('template[data-for]'),
  ]
  if (root instanceof HTMLTemplateElement && root.hasAttribute('data-for')) {
    templates.unshift(root)
  }
  for (const template of templates) {
    if (forControllerCleanups.has(template)) continue
    const value = template.getAttribute('data-for')?.trim() || ''
    if (!value) {
      forError('RocketForMissingExpression', template)
    }
    const match =
      value.match(
        /^(?<item>[A-Za-z_$][\w$]*)\s*,\s*(?<index>[A-Za-z_$][\w$]*)\s+in\s+(?<source>[\s\S]+)$/,
      ) ?? value.match(/^(?<item>[A-Za-z_$][\w$]*)\s+in\s+(?<source>[\s\S]+)$/)
    if (!match && /^[A-Za-z_$][\w$]*(?:\s*,|\s+in\b)/.test(value)) {
      forError('RocketForInvalidExpression', template, { value })
    }
    const { item = 'item', source = value, index = 'i' } = match?.groups ?? {}
    const controllerId = `c${nextForControllerId++}`
    const rx = genRx(source.trim(), { returnsValue_: true })
    const start = document.createComment('rocket-for:start')
    const end = document.createComment('rocket-for:end')
    template.parentNode!.insertBefore(start, template.nextSibling)
    start.parentNode!.insertBefore(end, start.nextSibling)
    const rows: ForRow[] = []
    const stop = effect(() => {
      const next = rx(template)
      const items =
        next == null
          ? []
          : Array.isArray(next)
            ? next
            : typeof next === 'string'
              ? [...next]
              : typeof next === 'object' && Symbol.iterator in next
                ? [...(next as Iterable<unknown>)]
                : (() => {
                    return forError('RocketForExpectedIterable', template, {
                      valueType: typeof next,
                    })
                  })()
      for (let i = items.length; i < rows.length; i += 1) {
        const row = rows[i]
        if (!row) continue
        for (const cleanup of row.cleanups) cleanup()
        for (let node: ChildNode | null = row.start; node; ) {
          const nextSibling: ChildNode | null = node.nextSibling
          node.remove()
          if (node === row.end) break
          node = nextSibling
        }

        // Write cleanup state without tracking so `mergePaths` cannot subscribe the outer loop to its own bookkeeping and retrigger it.
        startPeeking()
        try {
          mergePaths([[row.pathBase, null]])
        } finally {
          stopPeeking()
        }
      }
      rows.length = items.length
      let insertionPoint: Node = end
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const pathBase = `${scope.signalPathBase}._for.${controllerId}.row${i}`

        // Store reactive `rx()` values as untracked plain snapshots so parent loops do not subscribe to row bookkeeping.
        startPeeking()
        try {
          mergePaths([
            [
              `${pathBase}.${item}`,
              items[i] == null || typeof items[i] !== 'object'
                ? items[i]
                : (() => {
                    try {
                      return structuredClone(items[i])
                    } catch {
                      return JSON.parse(JSON.stringify(items[i]))
                    }
                  })(),
            ],
            [`${pathBase}.${index}`, i],
          ])
        } finally {
          stopPeeking()
        }
        let row = rows[i]
        if (!row) {
          // Mount nested row controllers without tracking so child setup cannot make the parent loop remount existing rows.
          startPeeking()
          try {
            const fragment = document.importNode(template.content, true)
            const localSignals = {
              ...(scope.localSignals ?? {}),
              [item]: `${pathBase}.${item}`,
              [index]: `${pathBase}.${index}`,
            }
            rewriteDataAttributes(fragment, {
              ...scope,
              localSignals,
            })
            const rowStart = document.createComment('rocket-for:row:start')
            const rowEnd = document.createComment('rocket-for:row:end')
            const nodes = [...fragment.childNodes]
            end.parentNode!.insertBefore(rowStart, insertionPoint)
            end.parentNode!.insertBefore(rowEnd, insertionPoint)
            end.parentNode!.insertBefore(fragment, rowEnd)
            row = {
              start: rowStart,
              end: rowEnd,
              pathBase,
              cleanups: [],
            }
            for (const node of nodes) {
              if (node instanceof Element) {
                row.cleanups.push(
                  ...initNested(node, {
                    ...scope,
                    localSignals,
                  }),
                )
              }
            }
          } finally {
            stopPeeking()
          }
          rows[i] = row
        }
        insertionPoint = row.start
      }
    })

    // Stop the outer effect before nested cleanup and untracked signal removal so teardown cannot resubscribe the loop to its own state.
    const cleanup = () => {
      stop()
      for (const row of rows) {
        if (!row) continue
        for (const fn of row.cleanups) fn()
        startPeeking()
        try {
          mergePaths([[row.pathBase, null]])
        } finally {
          stopPeeking()
        }
        for (let node: ChildNode | null = row.start; node; ) {
          const nextSibling: ChildNode | null = node.nextSibling
          node.remove()
          if (node === row.end) break
          node = nextSibling
        }
      }
      rows.length = 0
      start.remove()
      end.remove()
      forControllerCleanups.delete(template)
    }
    forControllerCleanups.set(template, cleanup)
    cleanups.push(cleanup)
  }
  return cleanups
}
