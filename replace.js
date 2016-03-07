import {ProseMirrorError} from "../util/error"

import {Fragment} from "./fragment"

export class ReplaceError extends ProseMirrorError {}

export class Slice {
  constructor(content, openLeft, openRight) {
    this.content = content
    this.openLeft = openLeft
    this.openRight = openRight
  }

  toJSON() {
    if (!this.content.size) return null
    return {content: this.content.toJSON(),
            openLeft: this.openLeft,
            openRight: this.openRight}
  }

  static fromJSON(schema, json) {
    if (!json) return new Slice.empty
    return new Slice(Fragment.fromJSON(schema, json.content), json.openLeft, json.openRight)
  }
}

Slice.empty = new Slice(Fragment.empty, 0, 0)

export function replace(from, to, slice) {
  if (slice.openLeft > from.depth)
    throw new ReplaceError("Inserted content deeper than insertion position")
  if (from.depth - slice.openLeft != to.depth - slice.openRight)
    throw new ReplaceError("Inconsistent open depths")
  return replaceOuter(from, to, slice, 0)
}

function replaceOuter(from, to, slice, depth) {
  let index = from.index[depth], node = from.node[depth]
  if (index == to.index[depth] && depth < from.depth - slice.openLeft) {
    let inner = replaceOuter(from, to, slice, depth + 1)
    return node.copy(node.content.replace(index, inner))
  } else if (slice.content.size) {
    let {start, end} = prepareSliceForReplace(slice, from)
    return close(node, replaceThreeWay(from, start, end, to, depth))
  } else {
    return close(node, replaceTwoWay(from, to, depth))
  }
}

function checkJoin(main, sub) {
  if (!main.type.canContainContent(sub.type))
    throw new ReplaceError("Can not join " + sub.type.name + " onto " + main.type.name)
}

function joinType(before, after, depth) {
  let main = before.node[depth], sub = after.node[depth]
  if (depth == before.depth && before.parentOffset == 0 && after.parentOffset < sub.content.size) {
    let tmp = main
    main = sub
    sub = tmp
  }
  checkJoin(main, sub)
  return main
}

function addNode(child, target) {
  let last = target.length - 1
  if (last >= 0 && child.isText && child.sameMarkup(target[last]))
    target[last] = child.copy(target[last].text + child.text)
  else
    target.push(child)
}

function addRange(start, end, depth, target) {
  let node = (end || start).node[depth]
  let startIndex = 0, endIndex = end ? end.index[depth] : node.childCount
  if (start) {
    startIndex = start.index[depth]
    if (start.depth > depth) {
      startIndex++
    } else if (start.parentOffset != start.offset[depth]) {
      addNode(start.nodeAfter, target)
      startIndex++
    }
  }
  for (let i = startIndex; i < endIndex; i++) addNode(node.child(i), target)
  if (end && end.depth == depth && end.parentOffset != end.offset[depth])
    addNode(end.nodeBefore, target)
}

function close(node, content) {
  return node.type.close(node.attrs, content, node.marks)
}

function replaceThreeWay(from, start, end, to, depth) {
  let openLeft = from.depth > depth && joinType(from, start, depth + 1)
  let openRight = to.depth > depth && joinType(end, to, depth + 1)

  let content = []
  addRange(null, from, depth, content)
  if (openLeft && openRight && start.index[depth] == end.index[depth]) {
    checkJoin(openLeft, openRight)
    addNode(close(openLeft, replaceThreeWay(from, start, end, to, depth + 1)), content)
  } else {
    if (openLeft)
      addNode(close(openLeft, replaceTwoWay(from, start, depth + 1)), content)
    addRange(start, end, depth, content)
    if (openRight)
      addNode(close(openRight, replaceTwoWay(end, to, depth + 1)), content)
  }
  addRange(to, null, depth, content)
  return new Fragment(content)
}

function replaceTwoWay(from, to, depth) {
  let content = []
  addRange(null, from, depth, content)
  if (from.depth > depth) {
    let type = joinType(from, to, depth + 1)
    addNode(close(type, replaceTwoWay(from, to, depth + 1)), content)
  }
  addRange(to, null, depth, content)
  return new Fragment(content)
}

function prepareSliceForReplace(slice, along) {
  let extra = along.depth - slice.openLeft, parent = along.node[extra]
  if (!parent.type.canContainFragment(slice.content))
    throw new ReplaceError("Content " + slice + " can not be placed in " + parent.type.name)
  let node = parent.copy(slice.content)
  // FIXME only copy up to start depth? rest won't be used
  for (let i = extra - 1; i >= 0; i--)
    node = along.node[i].copy(Fragment.from(node))
  return {start: node.context(slice.openLeft + extra, false),
          end: node.context(node.content.size - slice.openRight - extra, false)}
}
