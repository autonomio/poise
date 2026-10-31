export interface ServerBuild {
  entryPoints: string[]
  outfile: string
  defineSha?: boolean
}
export const SERVER_BUILDS: ServerBuild[]
