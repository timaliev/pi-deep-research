/** Convert a topic string to a filesystem-safe slug. Handles Unicode (Cyrillic, CJK, etc.). */
export function topicToSlug(topic: string): string {
  return topic
    .toLowerCase()
    // Transliterate common Cyrillic to Latin (naive but effective for filenames)
    .replace(/[а-яё]/g, (c) => {
      const map: Record<string, string> = {
        а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',
        к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
        х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
      };
      return map[c] ?? c;
    })
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80)
    || "research"; // fallback if all chars were stripped
}
