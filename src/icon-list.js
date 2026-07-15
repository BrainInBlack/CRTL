/* Curated icon names. BI_ICONS feeds the modal picker; CHROME_ICONS are the
   fixed UI glyphs (gear, edit affordances, ...). Their union is what the build
   bundles as inline SVGs - see scripts/gen-icons.mjs. Any name not listed here
   still works via fetch-on-add (see icons.js). */

export const BI_ICONS = [
  'house-fill','hdd-network-fill','hdd-stack-fill','diagram-3-fill','router-fill','ethernet',
  'shield-shaded','shield-lock-fill','shield-fill-check','cloud-fill','cloud-arrow-down-fill','globe',
  'display-fill','pc-display','box-seam-fill','boxes','server','cpu-fill','gpu-card','motherboard-fill',
  'film','camera-reels-fill','collection-play-fill','music-note-beamed','tv-fill','controller','image-fill',
  'git','github','code-slash','terminal-fill','journal-code','bug-fill','kanban-fill',
  'arrow-repeat','arrow-down-up','cloud-upload-fill','folder-fill','file-earmark-fill','archive-fill',
  'gear-fill','sliders','tools','key-fill','lock-fill','people-fill','person-badge-fill',
  'envelope-fill','chat-dots-fill','bell-fill','calendar-fill','clock-fill','graph-up','speedometer2',
  'database-fill','table','search','book-fill','bookmark-fill','tag-fill','printer-fill','camera-fill',
  'wifi','broadcast','reception-4','phone-fill','battery-charging','lightning-charge-fill','power','box-fill'
];

export const CHROME_ICONS = [
  'gear-fill','sliders','question-lg','question-circle','pencil-fill','trash-fill',
  'plus-lg','grip-vertical','three-dots-vertical','x-lg','check-lg','universal-access',
  'box-fill','box-seam-fill','sun-fill','moon-fill','download'
];
