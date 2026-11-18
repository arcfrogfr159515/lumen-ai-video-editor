/**
 * What an audio track is for, told from what it is called — in English or in Chinese. A new project names its
 * tracks in the window's language (人声, 音乐, 音效): they are the same tracks as Voice, Music and Sound effects,
 * to whatever places sounds, finds the speech, or leaves the music whole.
 */
export type AudioRole = 'voice' | 'music' | 'sfx'

export const ROLE_TRACK: Record<AudioRole, RegExp> = {
  voice: /voice|\bvo\b|narrat|dialog|interview|speech|人声|配音|旁白|语音|对白/i,
  music: /music|score|song|soundtrack|\bbed\b|音乐|配乐|歌曲/i,
  sfx: /sfx|sound|effect|foley|音效|效果音/i,
}
