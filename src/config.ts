/* USER CONFIGURATION - first-run seed only. Once you edit (or sync) a config,
   it lives in localStorage / the gist and these defaults are never read again.

   Entry shape:
     { name, icon, check, links: [{ label, url }, ...] }
   - icon: `bi:<name>` (Bootstrap Icons) or `svg:<name>` (simple-icons brand).
   - links[0] is the click target (after Away-mode reordering).
   - check: show a periodic health dot. */

import type { Group } from './types';

/** Endpoints reachable only from home. If any responds (no-cors), you're Home. */
export const DEFAULT_HOME_PROBES: string[] = [
  'http://192.168.1.1', // typical LAN gateway - replace with yours
  'http://10.0.0.1'     // optional second target (e.g. a VPN gateway)
];

export const DEFAULT_GROUPS: Group[] = [
  {
    group: "Network",
    entries: [
      { name: "Router", icon: "bi:diagram-3-fill", check: true, links: [
        { label: "DNS", url: "https://router.home" },
        { label: "IP",  url: "http://192.168.1.1" }
      ] },
      { name: "DNS / Pi-hole", icon: "bi:shield-shaded", check: true, links: [
        { label: "DNS", url: "https://pihole.home/admin" },
        { label: "IP",  url: "http://192.168.1.2/admin" }
      ] },
      { name: "Cloudflare", icon: "bi:cloud-fill", check: false, links: [
        { label: "Web", url: "https://dash.cloudflare.com" }
      ] }
    ]
  },
  {
    group: "Hosting",
    entries: [
      { name: "Proxmox", icon: "bi:display-fill", check: true, links: [
        { label: "DNS", url: "https://proxmox.home" },
        { label: "IP",  url: "http://192.168.1.10:8006" }
      ] },
      { name: "Portainer", icon: "bi:box-seam-fill", check: true, links: [
        { label: "DNS", url: "https://portainer.home" },
        { label: "IP",  url: "http://192.168.1.20:9443" }
      ] },
      { name: "NAS", icon: "bi:hdd-network-fill", check: true, links: [
        { label: "DNS", url: "https://nas.home" },
        { label: "IP",  url: "http://192.168.1.30" }
      ] }
    ]
  },
  {
    group: "Media",
    entries: [
      { name: "Jellyfin", icon: "bi:film", check: true, links: [
        { label: "Public", url: "https://media.example.com" },
        { label: "IP",     url: "http://192.168.1.40:8096" }
      ] },
      { name: "Sonarr", icon: "bi:collection-play-fill", check: true, links: [
        { label: "DNS", url: "https://sonarr.home" },
        { label: "IP",  url: "http://192.168.1.41:8989" }
      ] },
      { name: "Radarr", icon: "bi:camera-reels-fill", check: true, links: [
        { label: "DNS", url: "https://radarr.home" },
        { label: "IP",  url: "http://192.168.1.42:7878" }
      ] }
    ]
  },
  {
    group: "Apps",
    entries: [
      { name: "Home Assistant", icon: "bi:house-fill", check: true, links: [
        { label: "Public", url: "https://home.example.com" },
        { label: "IP",     url: "http://192.168.1.50:8123" }
      ] },
      { name: "Vaultwarden", icon: "bi:shield-lock-fill", check: true, links: [
        { label: "Public", url: "https://vault.example.com" },
        { label: "DNS",    url: "http://vault.home" },
        { label: "Admin",  url: "https://vault.example.com/admin" }
      ] },
      { name: "Gitea", icon: "bi:git", check: true, links: [
        { label: "Public", url: "https://git.example.com" },
        { label: "IP",     url: "http://192.168.1.60:3000" }
      ] },
      { name: "Syncthing", icon: "bi:arrow-repeat", check: false, links: [
        { label: "Local", url: "http://127.0.0.1:8384/" }
      ] }
    ]
  }
];
