// Heading anchors made the same way GitHub makes them, so a contents list written for
// GitHub (`[Costs so far](#costs-so-far)`) works in Commitbook too.
//
// GitHub: lower-case the heading text, drop punctuation (keeping letters, numbers,
// spaces, hyphens and underscores), turn spaces into hyphens, and add -1, -2… to repeats.

export function headingSlug(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Returns a function that gives each heading text its anchor, numbering repeats as GitHub does. */
export function slugger() {
  const occurrences = new Map();
  return text => {
    const original = headingSlug(text);
    let slug = original;
    while (occurrences.has(slug)) {
      occurrences.set(original, occurrences.get(original) + 1);
      slug = `${original}-${occurrences.get(original)}`;
    }
    occurrences.set(slug, 0);
    return slug;
  };
}
