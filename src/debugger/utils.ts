import { decode, encode } from 'base64-arraybuffer';
import {
  AutomationTarget,
  ClipType,
  Song,
  TickToSecondStepper,
  Track,
  TrackType,
  TuneflowPlugin,
} from 'tuneflow';
import type {
  AudioClipData,
  AutomationValue,
  Clip,
  LabelText,
  Note,
  ReadAPIs,
  SongAccess,
} from 'tuneflow';
import _ from 'underscore';
import i18next from 'i18next';
import socketio from 'socket.io-client';
import Config from './config.json';

import { song as songProtoModule } from './pbjs/song';

const SOCKETIO_CLIENT = socketio(`http://localhost:${Config.DevProxyPort}/devKit`);

export function getProxySocketClient() {
  return SOCKETIO_CLIENT;
}

export function createReadAPIs(): ReadAPIs {
  return {
    translateLabel: (labelText: LabelText) => getTranslatedLabelText(labelText),
    serializeSong: async (song: Song) => serializeSong(song),
    serializeSongAsUint8Array: async (song: Song) => serializeSongToUint8Array(song),
    deserializeSong: async (encodedSong: string) => deserializeSong(encodedSong),
    deserializeSongFromUint8Array: async (encodedSong: Uint8Array) =>
      deserializeSongFromUint8Array(encodedSong),
    readAudioBuffer: async (audioFile: string | File) => {
      let fileContent: ArrayBuffer;
      if (typeof audioFile === 'string') {
        // Local file.
        const response = await new Promise((resolve, unusedReject) => {
          SOCKETIO_CLIENT.emit('call-api', ['readFile', audioFile], (ack: any) => {
            resolve(ack);
          });
        });
        if (!response) {
          return null;
        }
        fileContent = response as ArrayBuffer;
      } else {
        // File object.
        fileContent = await (audioFile as File).arrayBuffer();
      }
      return new Promise((resolve, unusedReject) => {
        const audioContext = new AudioContext();
        return audioContext.decodeAudioData(fileContent, audioBuffer => {
          // Do something with audioBuffer
          resolve(audioBuffer);
        });
      });
    },
    readFile: async (filePath: string) => {
      return await new Promise((resolve, unusedReject) => {
        SOCKETIO_CLIENT.emit('call-api', ['readFile', filePath], (ack: any) => {
          resolve(ack);
        });
      }).then(response => {
        if (!response) {
          return null;
        }
        return new Uint8Array(response as ArrayBuffer);
      });
    },
    getAvailableAudioPlugins: async () => {
      return new Promise((resolve, unusedReject) => {
        SOCKETIO_CLIENT.emit('call-api', ['getAvailableAudioPlugins'], (ack: any) => {
          resolve(ack);
        });
      });
    },
    getFilesInDirectory: async (folderPath: string) => {
      return new Promise((resolve, unusedReject) => {
        SOCKETIO_CLIENT.emit('call-api', ['getFilesInDirectory', folderPath], (ack: any) => {
          resolve(ack);
        });
      });
    },
    resolvePath: async (path1: string, path2: string) => {
      return new Promise((resolve, unusedReject) => {
        SOCKETIO_CLIENT.emit('call-api', ['resolvePath', path1, path2], (ack: any) => {
          resolve(ack);
        });
      });
    },
    readPluginSpec: async (specPath: string) => {
      return new Promise((resolve, unusedReject) => {
        SOCKETIO_CLIENT.emit('call-api', ['readPluginSpec', specPath], (ack: any) => {
          resolve(ack);
        });
      });
    },
  };
}

function getTranslatedLabelText(labelText: LabelText): string {
  if (typeof labelText === 'string') {
    return labelText;
  }

  const currentLocale = i18next.language.split('-')[0].toLowerCase();
  const matchLocale = _.find(
    _.keys(labelText),
    key => key.split('-')[0].toLowerCase() === currentLocale,
  );
  if (matchLocale) {
    return labelText[matchLocale];
  } else if (_.keys(labelText).length > 0) {
    return labelText[_.keys(labelText)[0]];
  } else {
    return '';
  }
}

class TuneflowUtilsPlugin extends TuneflowPlugin {
  songAccess(): SongAccess {
    return {
      createTrack: true,
      removeTrack: true,
    };
  }
}

const utilsPlugin = new TuneflowUtilsPlugin();

async function songProtoToSong(songProto: songProtoModule.Song) {
  const song = new Song();
  // @ts-ignore
  song.setPluginContextInternal(utilsPlugin);
  song.setResolution(songProto.PPQ);
  // Time signatures have to be populated before tempos
  // so that tempos can be calculated correctly.
  for (const timeSignature of songProto.timeSignatures) {
    song.createTimeSignature({
      ticks: timeSignature.ticks as number,
      numerator: timeSignature.numerator as number,
      denominator: timeSignature.denominator as number,
    });
  }
  for (const tempo of songProto.tempos) {
    song.createTempoChange({
      ticks: tempo.ticks as number,
      bpm: tempo.bpm as number,
    });
  }
  for (const structure of songProto.structures) {
    song.createStructure({
      tick: structure.tick as number,
      type: structure.type as number,
      customName: structure.customName as string | undefined,
    });
  }
  const masterTrackProto = songProto.masterTrack as songProtoModule.Track;
  // @ts-ignore
  song.masterTrack = new Track({
    type: TrackType.MASTER_TRACK,
    uuid: masterTrackProto.uuid,
    volume: masterTrackProto.volume,
  });
  for (const trackProto of songProto.tracks) {
    const track = song.createTrack({
      type: trackProto.type as number,
      rank: trackProto.rank as number,
    });

    track.setId(trackProto.uuid as string);
    track.setVolume(trackProto.volume as number);
    track.setPan(trackProto.pan as number);
    track.setSolo(trackProto.solo as boolean);
    track.setMuted(trackProto.muted as boolean);
    if (trackProto.type === songProtoModule.TrackType.MIDI_TRACK) {
      track.setInstrument({
        program: (trackProto.instrument as any).program,
        isDrum: (trackProto.instrument as any).isDrum,
      });
      for (const suggestedInstrument of trackProto.suggestedInstruments as any[]) {
        track.createSuggestedInstrument({
          program: suggestedInstrument.program,
          isDrum: suggestedInstrument.isDrum,
        });
      }
    }

    for (const clipProto of trackProto.clips as songProtoModule.IClip[]) {
      let newClip: Clip;
      if (clipProto.type === songProtoModule.ClipType.AUDIO_CLIP) {
        const audioClipDataProto = clipProto.audioClipData as songProtoModule.AudioClipData;
        newClip = track.createAudioClip({
          clipStartTick: clipProto.clipStartTick as number,
          clipEndTick: clipProto.clipEndTick as number,
          audioClipData: {
            audioFilePath: audioClipDataProto.audioFilePath,
            startTick: audioClipDataProto.startTick,
            duration: audioClipDataProto.duration,
            audioData: audioClipDataProto.audioData
              ? {
                  format: audioClipDataProto.audioData.format as string,
                  data: audioClipDataProto.audioData.data as Uint8Array,
                }
              : undefined,
            pitchOffset: audioClipDataProto.pitchOffset,
            speedRatio: audioClipDataProto.speedRatio,
          },
        });
      } else if (clipProto.type === songProtoModule.ClipType.MIDI_CLIP) {
        newClip = track.createMIDIClip({
          clipStartTick: clipProto.clipStartTick as number,
          clipEndTick: clipProto.clipEndTick as number,
        });
      } else {
        throw new Error(`Unsupported clip type ${clipProto.type}`);
      }
      // @ts-ignore
      newClip.id = clipProto.id as string;
      if (clipProto.type === songProtoModule.ClipType.MIDI_CLIP && clipProto.notes) {
        let maxNoteId = 1;
        for (const note of clipProto.notes as songProtoModule.Note[]) {
          const newNote = newClip.createNote({
            pitch: note.pitch,
            velocity: note.velocity,
            startTick: note.startTick as number,
            endTick: note.endTick as number,
            updateClipRange: false,
            resolveClipConflict: false,
          });
          maxNoteId = Math.max(note.id, maxNoteId);
          if (newNote) {
            // @ts-ignore
            newNote.idInternal = note.id;
          }
        }
        // @ts-ignore
        newClip.nextNoteIdInternal = maxNoteId;
        // @ts-ignore
        newClip.getNextNoteIdInternal();
      } else if (clipProto.type === songProtoModule.ClipType.AUDIO_CLIP) {
        const audioClipData = clipProto.audioClipData;
        if (audioClipData) {
          newClip.setAudioFile(
            audioClipData.audioFilePath as string,
            audioClipData.startTick as number,
            audioClipData.duration as number,
          );
          (newClip.getAudioClipData() as AudioClipData).speedRatio =
            audioClipData.speedRatio as number;
          (newClip.getAudioClipData() as AudioClipData).pitchOffset =
            audioClipData.pitchOffset as number;
        }
      }
    }

    // Set plugins.
    if (trackProto.type === songProtoModule.TrackType.MIDI_TRACK) {
      if (trackProto.samplerPlugin && trackProto.samplerPlugin.tfId) {
        // @ts-ignore
        track.samplerPlugin = track.createAudioPlugin(trackProto.samplerPlugin.tfId);
        // @ts-ignore
        track.samplerPlugin.setIsEnabled(trackProto.samplerPlugin.isEnabled);
        // @ts-ignore
        track.samplerPlugin.localInstanceIdInternal = trackProto.samplerPlugin.localInstanceId;
      }
    }

    // Set automation.
    if (trackProto.automation) {
      if (trackProto.automation.targets) {
        for (let i = 0; i < trackProto.automation.targets.length; i += 1) {
          const targetProto = trackProto.automation.targets[i];
          track
            .getAutomation()
            .addAutomation(
              new AutomationTarget(
                targetProto.type as number,
                targetProto.audioPluginId as string | undefined,
                targetProto.paramId as string | undefined,
              ),
              i,
            );
        }
      }
      if (trackProto.automation.targetValues) {
        for (const tfAutomationTargetId of _.keys(trackProto.automation.targetValues)) {
          const targetValue = track.getAutomation().getAutomationValueById(tfAutomationTargetId);
          if (!targetValue) {
            // Only sync the values that have a target specified in the automation data.
            console.error(
              `Automation target ${tfAutomationTargetId} has values but is missing in track ${track.getId()}`,
            );
            continue;
          }
          const targetValueProto = trackProto.automation.targetValues[tfAutomationTargetId];
          targetValue.setDisabled(targetValueProto.disabled as boolean);
          if (targetValueProto.points && targetValueProto.points.length > 0) {
            let maxPointId = 1;
            for (const pointProto of targetValueProto.points) {
              const point = targetValue.addPoint(
                pointProto.tick as number,
                pointProto.value as number,
              );
              point.id = pointProto.id as number;
              maxPointId = Math.max(maxPointId, pointProto.id as number);
            }
            // @ts-ignore
            targetValue.nextPointIdInternal = maxPointId;
            // @ts-ignore
            targetValue.getNextPointIdInternal();
          }
        }
      }
    }
  }
  return song;
}

async function deserializeSong(encodedSong: string) {
  const arrayBuffer = decode(encodedSong);
  return deserializeSongFromUint8Array(new Uint8Array(arrayBuffer));
}

async function deserializeSongFromUint8Array(encodedSong: Uint8Array) {
  const songProto = songProtoModule.Song.decode(encodedSong);
  return songProtoToSong(songProto);
}

async function songToProto(song: Song) {
  const songProto = songProtoModule.Song.create();
  songProto.PPQ = song.getResolution();
  // Sync time signature.
  updateSongTimeSignatures(songProto, song);
  // Sync tempo.
  updateSongTempos(songProto, song);
  updateSongStructures(songProto, song);
  const tickToSecondStepper = new TickToSecondStepper(song.getTempoChanges(), song.getResolution());
  // Sync master track.
  if (!songProto.masterTrack) {
    songProto.masterTrack = songProtoModule.Track.create();
  }
  updateTrackProtoToTrack(
    songProto.masterTrack as songProtoModule.Track,
    song.getMasterTrack(),
    tickToSecondStepper,
  );
  // Sync tracks.
  const songProtoTrackMap = new Map<string, songProtoModule.Track>();
  const songTrackIndexMap = new Map<string, number>();
  if (songProto.tracks) {
    for (const track of songProto.tracks) {
      songProtoTrackMap.set(track.uuid as string, track as songProtoModule.Track);
    }
  } else {
    songProto.tracks = [];
  }
  for (let i = 0; i < song.getTracks().length; i += 1) {
    const track = song.getTracks()[i];
    songTrackIndexMap.set(track.getId(), i);
  }
  // Remove tracks that are not in the song.
  for (let i = songProto.tracks.length - 1; i >= 0; i -= 1) {
    const trackProto = songProto.tracks[i];
    const trackId = trackProto.uuid as string;
    if (!songTrackIndexMap.has(trackId)) {
      songProto.tracks.splice(i, 1);
    }
  }
  // Sync tracks in the new song.
  for (const track of song.getTracks()) {
    const trackId = track.getId();
    let trackProto: songProtoModule.Track;
    if (songProtoTrackMap.has(trackId)) {
      trackProto = songProtoTrackMap.get(trackId) as songProtoModule.Track;
    } else {
      trackProto = songProtoModule.Track.create();
      trackProto.uuid = track.getId();
      trackProto.type = track.getType() as number;
      songProto.tracks.push(trackProto);
    }
    updateTrackProtoToTrack(trackProto, track, tickToSecondStepper);
  }

  // Sort song proto tracks to match the order of song tracks.
  songProto.tracks.sort(
    (a, b) =>
      (songTrackIndexMap.get(a.uuid as string) as number) -
      (songTrackIndexMap.get(b.uuid as string) as number),
  );
  songProto.lastTick = song.getLastTick();
  songProto.duration = song.getDuration();
  return songProto;
}

async function serializeSong(song: Song) {
  return encode(await serializeSongToUint8Array(song));
}

async function serializeSongToUint8Array(song: Song) {
  const songProto = await songToProto(song);
  return songProtoModule.Song.encode(songProto).finish();
}

function updateSongTempos(songProto: songProtoModule.Song, song: Song) {
  if (!songProto.tempos) {
    songProto.tempos = [];
  }
  for (let i = 0; i < song.getTempoChanges().length; i += 1) {
    const tempoChange = song.getTempoChanges()[i];
    let tempoProto = songProto.tempos[i];
    if (!tempoProto) {
      tempoProto = songProtoModule.TempoEvent.create({
        ticks: tempoChange.getTicks(),
        time: tempoChange.getTime(),
        bpm: tempoChange.getBpm(),
      });
      songProto.tempos[i] = tempoProto;
    } else {
      if (tempoProto.bpm !== tempoChange.getBpm()) {
        tempoProto.bpm = tempoChange.getBpm();
      }
      if (tempoProto.ticks !== tempoChange.getTicks()) {
        tempoProto.ticks = tempoChange.getTicks();
      }
      if (tempoProto.time !== tempoChange.getTime()) {
        tempoProto.time = tempoChange.getTime();
      }
    }
  }
  // Now the length of tempo protos should be at least the length
  // of tf tempos.
  if (song.getTempoChanges().length !== songProto.tempos.length) {
    // trim tempo protos to be the same length as tempos.
    songProto.tempos.splice(
      song.getTempoChanges().length,
      songProto.tempos.length - song.getTempoChanges().length,
    );
  }
}

function updateSongStructures(songProto: songProtoModule.Song, song: Song) {
  songProto.structures = song.getStructures().map(item =>
    songProtoModule.StructureMarker.create({
      tick: item.getTick(),
      type: item.getType(),
      customName: item.getCustomName(),
    }),
  );
}

function updateSongTimeSignatures(songProto: songProtoModule.Song, song: Song) {
  if (!songProto.timeSignatures) {
    songProto.timeSignatures = [];
  }
  for (let i = 0; i < song.getTimeSignatures().length; i += 1) {
    const timeSignature = song.getTimeSignatures()[i];
    let timeSignatureProto = songProto.timeSignatures[i];
    if (!timeSignatureProto) {
      timeSignatureProto = songProtoModule.TimeSignatureEvent.create({
        ticks: timeSignature.getTicks(),
        numerator: timeSignature.getNumerator(),
        denominator: timeSignature.getDenominator(),
      });
      songProto.timeSignatures[i] = timeSignatureProto;
    } else {
      if (timeSignatureProto.numerator !== timeSignature.getNumerator()) {
        timeSignatureProto.numerator = timeSignature.getNumerator();
      }
      if (timeSignatureProto.denominator !== timeSignature.getDenominator()) {
        timeSignatureProto.denominator = timeSignature.getDenominator();
      }
      if (timeSignatureProto.ticks !== timeSignature.getTicks()) {
        timeSignatureProto.ticks = timeSignature.getTicks();
      }
    }
  }
  // Now the length of time signature protos should be at least the length
  // of tf time signatures.
  if (song.getTimeSignatures().length !== songProto.timeSignatures.length) {
    // trim time signature protos to be the same length as time signatures.
    songProto.timeSignatures.splice(
      song.getTimeSignatures().length,
      songProto.timeSignatures.length - song.getTimeSignatures().length,
    );
  }
}

/** Update the track proto with the corresponding track with the same track id. */
function updateTrackProtoToTrack(
  trackProto: songProtoModule.Track,
  track: Track,
  tickToSecondStepper: TickToSecondStepper,
) {
  trackProto.uuid = track.getId();
  trackProto.rank = track.getRank();
  if (trackProto.type !== (track.getType() as number)) {
    trackProto.type = track.getType() as number;
  }

  if (track.getType() === TrackType.MIDI_TRACK) {
    if (!trackProto.instrument) {
      trackProto.instrument = songProtoModule.InstrumentInfo.create();
    }
    let trackIsDrum = false;
    let trackProgram = 0;
    const trackInstrument = track.getInstrument();
    if (trackInstrument) {
      trackIsDrum = trackInstrument.getIsDrum();
      trackProgram = trackInstrument.getProgram();
    }
    if (trackProto.instrument.isDrum !== trackIsDrum) {
      trackProto.instrument.isDrum = trackIsDrum;
    }
    if (trackProto.instrument.program !== trackProgram) {
      trackProto.instrument.program = trackProgram;
    }
  } else {
    if (trackProto.instrument) {
      delete trackProto.instrument;
    }
  }

  if (trackProto.volume !== track.getVolume()) {
    trackProto.volume = track.getVolume();
  }
  if (trackProto.pan !== track.getPan()) {
    trackProto.pan = track.getPan();
  }
  if (trackProto.solo !== track.getSolo()) {
    trackProto.solo = track.getSolo();
  }
  if (trackProto.muted !== track.getMuted()) {
    trackProto.muted = track.getMuted();
  }
  trackProto.trackStartTick = track.getTrackStartTick();
  trackProto.trackEndTick = track.getTrackEndTick();
  trackProto.suggestedInstruments = [];
  for (const suggestedInstrument of track.getSuggestedInstruments()) {
    const suggestedInstrumentProto = songProtoModule.InstrumentInfo.create();
    suggestedInstrumentProto.program = suggestedInstrument.getProgram();
    suggestedInstrumentProto.isDrum = suggestedInstrument.getIsDrum();
    trackProto.suggestedInstruments.push(suggestedInstrumentProto);
  }
  const trackProtoClipMap = new Map<string, songProtoModule.Clip>();
  const trackClipIndexMap = new Map<string, number>();
  if (!trackProto.clips) {
    trackProto.clips = [];
  }
  for (const clipProto of trackProto.clips) {
    trackProtoClipMap.set(clipProto.id as string, clipProto as songProtoModule.Clip);
  }
  for (let i = 0; i < track.getClips().length; i += 1) {
    const clip = track.getClips()[i];
    trackClipIndexMap.set(clip.getId(), i);
  }
  // Remove clips that are not in the track.
  for (let i = trackProto.clips.length - 1; i >= 0; i -= 1) {
    const clipProto = trackProto.clips[i];
    const clipId = clipProto.id as string;
    if (!trackClipIndexMap.has(clipId)) {
      trackProto.clips.splice(i, 1);
    }
  }
  // Sync new track clips.
  for (const clip of track.getClips()) {
    const clipId = clip.getId();
    let clipProto: songProtoModule.Clip;
    if (trackProtoClipMap.has(clipId)) {
      clipProto = trackProtoClipMap.get(clipId) as songProtoModule.Clip;
    } else {
      clipProto = songProtoModule.Clip.create();
      clipProto.id = clip.getId();
      clipProto.type = clip.getType();
      trackProto.clips.push(clipProto);
    }

    updateClipProtoToClip(track.getId(), clipProto, clip, tickToSecondStepper);
  }

  // Sort clip protos by the order of clips in the track.
  trackProto.clips.sort(
    (a, b) =>
      (trackClipIndexMap.get(a.id as string) as number) -
      (trackClipIndexMap.get(b.id as string) as number),
  );

  // Populate plugins.
  if (track.getType() === TrackType.MIDI_TRACK) {
    const trackSamplerPlugin = track.getSamplerPlugin();
    if (trackSamplerPlugin && trackSamplerPlugin.getTuneflowId()) {
      if (!trackProto.samplerPlugin) {
        trackProto.samplerPlugin = songProtoModule.AudioPluginInfo.create();
      }
      if (trackProto.samplerPlugin.localInstanceId !== trackSamplerPlugin.getInstanceId()) {
        trackProto.samplerPlugin.localInstanceId = trackSamplerPlugin.getInstanceId();
      }
      if (trackProto.samplerPlugin.tfId !== trackSamplerPlugin.getTuneflowId()) {
        trackProto.samplerPlugin.tfId = trackSamplerPlugin.getTuneflowId();
      }
      if (trackProto.samplerPlugin.isEnabled !== trackSamplerPlugin.getIsEnabled()) {
        trackProto.samplerPlugin.isEnabled = trackSamplerPlugin.getIsEnabled();
      }
      if (
        (!!trackProto.samplerPlugin.base64States && !trackSamplerPlugin.getBase64States()) ||
        (!trackProto.samplerPlugin.base64States && !!trackSamplerPlugin.getBase64States()) ||
        (!!trackProto.samplerPlugin.base64States &&
          !!trackSamplerPlugin.getBase64States() &&
          trackProto.samplerPlugin.base64States !== trackSamplerPlugin.getBase64States())
      ) {
        trackProto.samplerPlugin.base64States = trackSamplerPlugin.getBase64States();
      }
    } else if (trackProto.samplerPlugin) {
      delete trackProto.samplerPlugin;
    }
  } else {
    // If the track is not MIDI track, delete sampler plugin.
    if (trackProto.samplerPlugin) {
      delete trackProto.samplerPlugin;
    }
  }

  // Populate automations.
  if (track.hasAnyAutomation()) {
    if (!trackProto.automation) {
      trackProto.automation = songProtoModule.AutomationData.create();
    }
    if (!trackProto.automation.targets) {
      trackProto.automation.targets = [];
    }
    if (!trackProto.automation.targetValues) {
      trackProto.automation.targetValues = {};
    }
    // Sync targets.
    const newTargetIds = new Set<string>();
    for (let i = 0; i < track.getAutomation().getAutomationTargets().length; i += 1) {
      const target = track.getAutomation().getAutomationTargets()[i];
      const tfAutomationTargetId = target.toTfAutomationTargetId();
      newTargetIds.add(tfAutomationTargetId);
      let targetProto = trackProto.automation.targets[i] as songProtoModule.AutomationTarget;
      if (!targetProto) {
        targetProto = songProtoModule.AutomationTarget.create({
          type: target.getType() as number,
          audioPluginId: target.getPluginInstanceId(),
          paramId: target.getParamId(),
        });
        trackProto.automation.targets[i] = targetProto;
      } else if (
        AutomationTarget.encodeAutomationTarget(
          targetProto.type as number,
          targetProto.audioPluginId,
          targetProto.paramId,
        ) !== tfAutomationTargetId
      ) {
        targetProto.type = target.getType() as number;
        targetProto.audioPluginId = target.getPluginInstanceId() as string;
        targetProto.paramId = target.getParamId() as string;
      }
    }
    // Remove targets that are not in the new targets.
    trackProto.automation.targets.splice(
      track.getAutomation().getAutomationTargets().length,
      trackProto.automation.targets.length - track.getAutomation().getAutomationTargets().length,
    );

    // Sync target values.
    const newTargetValueTargetIds = new Set<string>();
    for (const tfAutomationTargetId of _.keys(track.getAutomation().getAutomationTargetValues())) {
      if (!newTargetIds.has(tfAutomationTargetId)) {
        // Only sync values that has a target.
        continue;
      }
      newTargetValueTargetIds.add(tfAutomationTargetId);
      const targetValue = track.getAutomation().getAutomationTargetValues()[
        tfAutomationTargetId
      ] as AutomationValue;
      let targetValueProto = trackProto.automation.targetValues[
        tfAutomationTargetId
      ] as songProtoModule.AutomationValue;
      if (!targetValueProto) {
        targetValueProto = songProtoModule.AutomationValue.create();
        trackProto.automation.targetValues[tfAutomationTargetId] = targetValueProto;
      }
      if (targetValueProto.disabled !== targetValue.getDisabled()) {
        targetValueProto.disabled = targetValue.getDisabled();
      }
      // Sync points.
      for (let i = 0; i < targetValue.getPoints().length; i += 1) {
        const automationPoint = targetValue.getPoints()[i];
        let automationPointProto = targetValueProto.points[i];
        if (!automationPointProto) {
          automationPointProto = songProtoModule.AutomationValue.ParamValue.create({
            tick: automationPoint.tick,
            value: automationPoint.value,
            id: automationPoint.id,
          });
          targetValueProto.points[i] = automationPointProto;
        } else {
          if (automationPointProto.id !== automationPoint.id) {
            automationPointProto.id = automationPoint.id;
          }
          if (automationPointProto.tick !== automationPoint.tick) {
            automationPointProto.tick = automationPoint.tick;
          }
          if (automationPointProto.value !== automationPoint.value) {
            automationPointProto.value = automationPoint.value;
          }
        }
      }
      if (targetValueProto.points.length !== targetValue.getPoints().length) {
        targetValueProto.points.splice(
          targetValue.getPoints().length,
          targetValueProto.points.length - targetValue.getPoints().length,
        );
      }
    }
    // Remove target value protos that are not in the new target values.
    for (const existingTfTargetId of _.keys(trackProto.automation.targetValues)) {
      if (
        // The target has to be in both the new targets and new target values.
        // Otherwise we should remove it.
        !newTargetIds.has(existingTfTargetId) ||
        !newTargetValueTargetIds.has(existingTfTargetId) ||
        !track.getAutomation().getAutomationValueById(existingTfTargetId)
      ) {
        delete trackProto.automation.targetValues[existingTfTargetId];
      }
    }
  } else if (trackProto.automation) {
    delete trackProto.automation;
  }
}

function updateClipProtoToClip(
  trackId: string,
  clipProto: songProtoModule.Clip,
  clip: Clip,
  tickToSecondStepper: TickToSecondStepper,
) {
  if (clipProto.clipStartTick !== clip.getClipStartTick()) {
    clipProto.clipStartTick = clip.getClipStartTick();
  }
  if (clipProto.clipEndTick !== clip.getClipEndTick()) {
    clipProto.clipEndTick = clip.getClipEndTick();
  }
  if (clipProto.type !== clip.getType()) {
    clipProto.type = clip.getType();
  }

  // Sync notes.
  if (clip.getType() === ClipType.MIDI_CLIP) {
    const clipProtoNoteMap = new Map<number, songProtoModule.Note>();
    const clipNoteMap = new Map<number, Note>();
    for (const noteProto of clipProto.notes) {
      clipProtoNoteMap.set(noteProto.id as number, noteProto as songProtoModule.Note);
    }
    for (const note of clip.getRawNotes()) {
      clipNoteMap.set(note.getId(), note);
    }
    // Remove notes that are not in the clip.
    for (let i = clipProto.notes.length - 1; i >= 0; i -= 1) {
      const noteProto = clipProto.notes[i];
      const noteId = noteProto.id as number;
      if (!clipNoteMap.has(noteId)) {
        clipProto.notes.splice(i, 1);
      }
    }
    // Sync notes in the clip.
    for (const note of clip.getRawNotes()) {
      let noteProto;
      const noteId = note.getId();
      if (clipProtoNoteMap.has(noteId)) {
        noteProto = clipProtoNoteMap.get(noteId) as songProtoModule.Note;
      } else {
        noteProto = songProtoModule.Note.create();
        noteProto.id = note.getId();
        clipProto.notes.push(noteProto);
      }
      if (noteProto.pitch !== note.getPitch()) {
        noteProto.pitch = note.getPitch();
      }
      if (noteProto.velocity !== note.getVelocity()) {
        noteProto.velocity = note.getVelocity();
      }
      if (noteProto.startTick !== note.getStartTick()) {
        noteProto.startTick = note.getStartTick();
      }
      noteProto.startTime = tickToSecondStepper.tickToSeconds(note.getStartTick());
      if (noteProto.endTick !== note.getEndTick()) {
        noteProto.endTick = note.getEndTick();
      }
      noteProto.endTime = tickToSecondStepper.tickToSeconds(note.getEndTick());
    }
    // Sort notes.
    clipProto.notes.sort((a, b) => (a.startTick as number) - (b.startTick as number));
  } else {
    // Non-MIDI clip should not have ntoes.
    if (clipProto.notes && clipProto.notes.length > 0) {
      clipProto.notes = [];
    }
  }

  const clipAudioData = clip.getAudioClipData();
  if (clip.getType() === ClipType.AUDIO_CLIP && clipAudioData) {
    if (!clipProto.audioClipData) {
      clipProto.audioClipData = songProtoModule.AudioClipData.create();
    }
    if (clipProto.audioClipData.audioFilePath !== clipAudioData.audioFilePath) {
      clipProto.audioClipData.audioFilePath = clipAudioData.audioFilePath;
    }
    if (clipAudioData.audioData && clipAudioData.audioData.data) {
      clipProto.audioClipData.audioData = songProtoModule.AudioData.create({
        data: clipAudioData.audioData.data,
        format: clipAudioData.audioData.format,
      });
    }
    if (clipProto.audioClipData.startTick !== clipAudioData.startTick) {
      clipProto.audioClipData.startTick = clipAudioData.startTick;
    }
    if (clipProto.audioClipData.duration !== clipAudioData.duration) {
      clipProto.audioClipData.duration = clipAudioData.duration;
    }
    if (clipProto.audioClipData.speedRatio !== clipAudioData.speedRatio) {
      clipProto.audioClipData.speedRatio = clipAudioData.speedRatio;
    }
    if (clipProto.audioClipData.pitchOffset !== clipAudioData.pitchOffset) {
      clipProto.audioClipData.pitchOffset = clipAudioData.pitchOffset;
    }
  } else if (clipProto.type !== ClipType.AUDIO_CLIP || !clipAudioData) {
    // New clip doesn't have audio clip data, clear it in the proto.
    if (clipProto.audioClipData) {
      delete clipProto.audioClipData;
    }
  }
}
