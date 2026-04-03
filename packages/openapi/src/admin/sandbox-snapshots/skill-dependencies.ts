/**
 * Skill dependency declarations — shared between frontend (preview) and backend (resolution).
 *
 * Each official skill declares its system packages per platform (apt for Docker/Debian,
 * dnf for Vercel/Amazon Linux 2023), plus cross-platform pip and npm packages.
 *
 * Platform differences:
 * - AL2023 (Vercel node22): python3 is pre-installed; are NOT in
 *   standard repos; ffmpeg requires static binary download.
 * - Debian (Docker node:22-slim): full package availability via apt-get.
 */

/** Describes a static binary to download on platforms lacking the package in repos. */
export interface IBinaryInstall {
  /** Human-readable tool name (e.g. 'ffmpeg') */
  name: string;
  /** Download URL for the archive */
  url: string;
  /** Archive format */
  format: 'tar.xz' | 'tar.gz';
  /** Glob pattern for the directory inside the archive (e.g. 'ffmpeg-*-amd64-static') */
  stripDir: string;
  /** Binary filenames to copy from the archive dir (e.g. ['ffmpeg', 'ffprobe']) */
  binaries: string[];
}

/** Declares a pip package that bundles a binary, needing a symlink to PATH on dnf platforms. */
export interface IPipBinaryLink {
  /** Pip package that provides the binary (auto-added to pipPackages on dnf) */
  package: string;
  /** Python expression for `python3 -c "..."` that prints the bundled binary's absolute path */
  findExpr: string;
  /** Symlink name in ~/.local/bin (e.g. 'pandoc') */
  name: string;
}

export interface ISkillDependencies {
  /** Packages for apt-based systems (Docker sandbox, Debian/Ubuntu) */
  aptPackages: string[];
  /** Packages for dnf-based systems (Vercel sandbox, Amazon Linux 2023) */
  dnfPackages: string[];
  /** Binary tools to download on dnf platforms where they're not in repos */
  dnfBinaryInstalls?: IBinaryInstall[];
  /** Pip packages that bundle binaries, needing symlinks to PATH (dnf platforms only) */
  dnfPipBinaryLinks?: IPipBinaryLink[];
  pipPackages: string[];
  npmPackages: string[];
}

export type SkillPlatform = 'apt' | 'dnf';

export interface IResolvedSkillDependencies {
  merged: {
    systemPackages: string[];
    binaryInstalls: IBinaryInstall[];
    pipBinaryLinks: IPipBinaryLink[];
    pipPackages: string[];
    npmPackages: string[];
  };
  /** Maps each package name → the skill slugs that require it. */
  attribution: Record<string, string[]>;
}

const PY3 = 'python3';
const PY3_PIP = 'python3-pip';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const SKILL_DEPENDENCIES: Record<string, ISkillDependencies> = {
  xlsx: {
    aptPackages: [PY3, PY3_PIP],
    dnfPackages: [PY3_PIP],
    pipPackages: ['pandas', 'openpyxl'],
    npmPackages: [],
  },
  pdf: {
    aptPackages: [PY3, PY3_PIP, 'ghostscript'],
    dnfPackages: [PY3_PIP, 'ghostscript'],
    pipPackages: ['pypdf', 'pdfplumber'],
    npmPackages: [],
  },
  docx: {
    aptPackages: [PY3, PY3_PIP, 'pandoc'],
    dnfPackages: [PY3_PIP],
    dnfPipBinaryLinks: [
      {
        package: 'pypandoc_binary',
        findExpr:
          "import pypandoc, os; print(os.path.join(os.path.dirname(pypandoc.__file__), 'files', 'pandoc'))",
        name: 'pandoc',
      },
    ],
    pipPackages: [],
    npmPackages: ['docx'],
  },
  pptx: {
    aptPackages: [PY3, PY3_PIP],
    dnfPackages: [PY3_PIP],
    pipPackages: ['markitdown'],
    npmPackages: ['pptxgenjs'],
  },
  ffmpeg: {
    aptPackages: ['ffmpeg'],
    dnfPackages: ['xz'], // needed to extract tar.xz archive
    dnfBinaryInstalls: [
      {
        name: 'ffmpeg',
        url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
        format: 'tar.xz',
        stripDir: 'ffmpeg-*-amd64-static',
        binaries: ['ffmpeg', 'ffprobe'],
      },
    ],
    pipPackages: [],
    npmPackages: [],
  },
};

function addAttribution(attribution: Record<string, string[]>, pkg: string, slug: string): void {
  if (!attribution[pkg]) attribution[pkg] = [];
  if (!attribution[pkg].includes(slug)) attribution[pkg].push(slug);
}

function addWithAttribution(
  attribution: Record<string, string[]>,
  pkg: string,
  slug: string,
  set: Set<string>
): void {
  set.add(pkg);
  addAttribution(attribution, pkg, slug);
}

function collectDnfExtras(
  deps: ISkillDependencies,
  slug: string,
  attribution: Record<string, string[]>,
  pipSet: Set<string>,
  binaryMap: Map<string, IBinaryInstall>,
  linkMap: Map<string, IPipBinaryLink>
): void {
  for (const bi of deps.dnfBinaryInstalls ?? []) {
    if (!binaryMap.has(bi.name)) binaryMap.set(bi.name, bi);
    addAttribution(attribution, bi.name, slug);
  }
  for (const link of deps.dnfPipBinaryLinks ?? []) {
    addWithAttribution(attribution, link.package, slug, pipSet);
    if (!linkMap.has(link.name)) linkMap.set(link.name, link);
  }
}

/**
 * Resolve merged dependencies for a set of selected skill slugs.
 * Deduplicates packages and tracks which skills require each package (attribution).
 *
 * @param slugs - Skill slugs to resolve
 * @param platform - Target platform; defaults to 'apt' (Docker).
 *                   Use 'dnf' for Vercel/Amazon Linux 2023.
 */
export function resolveSkillDependencies(
  slugs: string[],
  platform: SkillPlatform = 'apt'
): IResolvedSkillDependencies {
  const attribution: Record<string, string[]> = {};
  const systemSet = new Set<string>();
  const pipSet = new Set<string>();
  const npmSet = new Set<string>();
  const binaryMap = new Map<string, IBinaryInstall>();
  const linkMap = new Map<string, IPipBinaryLink>();
  const pkgKey = platform === 'dnf' ? 'dnfPackages' : 'aptPackages';

  for (const slug of slugs) {
    const deps = SKILL_DEPENDENCIES[slug];
    if (!deps) continue;

    for (const p of deps[pkgKey]) addWithAttribution(attribution, p, slug, systemSet);
    for (const p of deps.pipPackages) addWithAttribution(attribution, p, slug, pipSet);
    for (const p of deps.npmPackages) addWithAttribution(attribution, p, slug, npmSet);

    if (platform === 'dnf') {
      collectDnfExtras(deps, slug, attribution, pipSet, binaryMap, linkMap);
    }
  }

  return {
    merged: {
      systemPackages: [...systemSet],
      binaryInstalls: [...binaryMap.values()],
      pipBinaryLinks: [...linkMap.values()],
      pipPackages: [...pipSet],
      npmPackages: [...npmSet],
    },
    attribution,
  };
}
