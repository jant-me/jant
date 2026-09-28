import { genRx } from '@engine'
import { createError } from '@engine/errors'
import { effect } from '@engine/signals'
import type { HTMLOrSVG } from '@engine/types'
import { rewriteDataAttributes, type TaggedLiteralScope } from './template'

type ConditionalBranch = {
  template: HTMLTemplateElement
  kind: 'if' | 'else-if' | 'else'
  rx?: <T>(el: HTMLOrSVG, ...args: any[]) => T
}

const conditionalControllerCleanups = new WeakMap<
  HTMLTemplateElement,
  () => void
>()

// Classify a template branch so chain validation can enforce `if -> else-if -> else` ordering.
const conditionalKind = (template: HTMLTemplateElement) => {
  if (template.hasAttribute('data-if')) return 'if' as const
  if (template.hasAttribute('data-else-if')) return 'else-if' as const
  if (template.hasAttribute('data-else')) return 'else' as const
}

// Include enough DOM context in conditional errors to locate the broken template quickly.
const conditionalError = (
  reason: string,
  template: HTMLTemplateElement,
): never => {
  throw createError(
    { element: { id: template.id, tag: template.tagName } },
    reason,
  )
}

// Mount each adjacent conditional chain under one effect so only the active branch remains in the DOM.
const initConditionalChain = (
  head: HTMLTemplateElement,
  scope: ConditionalScope,
  initNested: (
    root: ParentNode,
    scope: TaggedLiteralScope,
  ) => Array<() => void>,
) => {
  // Use one branch controller for adjacent conditional templates so only the active fragment remains mounted and scoped.
  const branches: ConditionalBranch[] = [
    {
      template: head,
      kind: 'if',
      rx: genRx(head.getAttribute('data-if') || '', { returnsValue_: true }),
    },
  ]
  let tail = head
  let seenElse = false
  for (
    let node = head.nextElementSibling;
    node instanceof HTMLTemplateElement;
    node = node.nextElementSibling
  ) {
    const kind = conditionalKind(node)
    if (!kind || kind === 'if') break
    if (kind === 'else') {
      if (seenElse) conditionalError('RocketConditionalDuplicateElse', node)
      branches.push({ template: node, kind })
      tail = node
      seenElse = true
      continue
    }
    if (seenElse) conditionalError('RocketConditionalElseIfAfterElse', node)
    branches.push({
      template: node,
      kind,
      rx: genRx(node.getAttribute('data-else-if') || '', {
        returnsValue_: true,
      }),
    })
    tail = node
  }
  const start = document.createComment('rocket-if:start')
  const end = document.createComment('rocket-if:end')
  tail.parentNode!.insertBefore(start, tail.nextSibling)
  start.parentNode!.insertBefore(end, start.nextSibling)
  let activeIndex = -1
  let nestedCleanups: Array<() => void> = []

  const clearMountedBranch = () => {
    for (const cleanup of nestedCleanups) cleanup()
    nestedCleanups = []
    for (let node = start.nextSibling; node && node !== end; ) {
      const nextSibling = node.nextSibling
      node.remove()
      node = nextSibling
    }
  }

  const stop = effect(() => {
    const nextIndex = branches.findIndex((branch) =>
      branch.kind === 'else' ? true : !!branch.rx?.(branch.template),
    )
    if (nextIndex === activeIndex) return
    clearMountedBranch()
    activeIndex = nextIndex
    if (nextIndex === -1) return
    const fragment = document.importNode(
      branches[nextIndex]!.template.content,
      true,
    )
    rewriteDataAttributes(fragment, scope)
    const nodes = [...fragment.childNodes]
    end.parentNode!.insertBefore(fragment, end)
    for (const node of nodes) {
      if (node instanceof Element) {
        nestedCleanups.push(...initNested(node, scope))
      }
    }
  })

  return () => {
    stop()
    clearMountedBranch()
    start.remove()
    end.remove()
    conditionalControllerCleanups.delete(head)
  }
}

type ConditionalScope = TaggedLiteralScope

// Mount each conditional head once so rescans cannot stack duplicate controllers on the same template.
export const initRocketConditionals = (
  root: ParentNode,
  scope: ConditionalScope,
  initNested: (
    root: ParentNode,
    scope: TaggedLiteralScope,
  ) => Array<() => void>,
) => {
  const cleanups: Array<() => void> = []
  const templates = [...root.querySelectorAll<HTMLTemplateElement>('template')]
  if (root instanceof HTMLTemplateElement) templates.unshift(root)
  for (const template of templates) {
    if (!conditionalKind(template)) continue
    if (
      Number(template.hasAttribute('data-if')) +
        Number(template.hasAttribute('data-else-if')) +
        Number(template.hasAttribute('data-else')) !==
      1
    ) {
      conditionalError(
        'RocketConditionalTemplateHasMultipleConditions',
        template,
      )
    }
    if (conditionalKind(template) !== 'if') {
      const prev = template.previousElementSibling
      if (!(prev instanceof HTMLTemplateElement)) {
        conditionalError('RocketConditionalMissingPreviousBranch', template)
      }
      const prevKind = conditionalKind(prev as HTMLTemplateElement)
      if (!prevKind || prevKind === 'else') {
        conditionalError('RocketConditionalInvalidPreviousBranch', template)
      }
    }
    if (conditionalKind(template) !== 'if') continue
    if (conditionalControllerCleanups.has(template)) continue
    const cleanup = initConditionalChain(template, scope, initNested)
    conditionalControllerCleanups.set(template, cleanup)
    cleanups.push(cleanup)
  }
  return cleanups
}
