/** Executable Python skill packages (Prime Agent adoption). */

export interface ExecutableSkillManifest {
  name: string;
  description: string;
  version?: string;
  triggers?: string[];
  entrypoint?: string;
  packagePath: string;
  skillMdPath?: string;
  scope: SkillPackageRef['scope'];
  highRisk?: boolean;
}

export interface SkillPackageRef {
  name: string;
  scope: 'project' | 'global' | 'bundled';
  path: string;
}
