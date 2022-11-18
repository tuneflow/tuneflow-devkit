<script lang="ts">
import { defineComponent, ref, computed } from 'vue';
import socketio from 'socket.io-client';
import { TuneflowPlugin } from 'tuneflow';
import PluginClass from '../plugin/export';
import Config from './config.json';
import { createReadAPIs } from './utils';

export default defineComponent({
  setup() {
    const isRunningPlugin = ref(false);
    const pluginAvailable = computed(() => PluginClass !== null && PluginClass !== undefined);
    const remoteApis = computed(() => createReadAPIs());
    const socketioClient = socketio(`http://localhost:${Config.DevProxyPort}/devKit`);
    const serializedSong = ref(null as any);
    const plugin = ref(null as any);
    const pluginName = PluginClass
      ? remoteApis.value.translateLabel(PluginClass.pluginDisplayName())
      : null;
    return {
      isRunningPlugin,
      pluginAvailable,
      socketioClient,
      serializedSong,
      remoteApis,
      plugin,
      pluginName,
    };
  },
  mounted() {
    this.socketioClient.on('set-song', async (payload, callback) => {
      if (PluginClass) {
        try {
          this.plugin = null;
          this.serializedSong = payload.serializedSong;
        } catch (e: any) {
          console.error(e);
        }
        callback({
          status: 'OK',
          pluginInfo: {
            pluginDisplayName: (PluginClass as typeof TuneflowPlugin).pluginDisplayName(),
            pluginDescription: (PluginClass as typeof TuneflowPlugin).pluginDescription(),
            providerDisplayName: (PluginClass as typeof TuneflowPlugin).providerDisplayName(),
          },
        });
      } else {
        callback({
          status: 'PLUGIN_NOT_READY',
        });
      }
    });

    this.socketioClient.on('init-plugin', async (payload, callback) => {
      if (PluginClass && this.serializedSong) {
        const song = await this.remoteApis.deserializeSong(this.serializedSong);
        this.plugin = await (PluginClass as any).create(song, this.remoteApis);

        callback({
          status: 'OK',
          paramsConfig: this.plugin.params(),
          params: this.plugin.getParamsInternal(),
        });
      } else {
        callback({
          status: 'SONG_OR_PLUGIN_NOT_READY',
        });
      }
    });

    this.socketioClient.on('run-plugin', async (payload, callback) => {
      const { params } = payload;
      if (this.plugin && this.serializedSong) {
        const song = await this.remoteApis.deserializeSong(this.serializedSong);
        this.isRunningPlugin = true;
        try {
          await this.plugin.run(song, params);
        } catch (e: any) {
          console.error(e);
        }
        this.isRunningPlugin = false;

        callback({
          status: 'OK',
          serializedSongResult: await this.remoteApis.serializeSong(song),
        });
      } else {
        callback({
          status: 'SONG_OR_PLUGIN_NOT_READY',
        });
      }
    });
  },
});
</script>

<template>
  <div :class="$style.Container">
    <h2>当前状态</h2>
    <div :class="$style.Status">
      当前插件:
      {{ pluginAvailable ? pluginName : '尚未加载插件，请修改src/plugin/exports.ts后重新加载页面' }}
    </div>
    <h2>如何使用TuneFlow调试工具</h2>
    <div :class="$style.Instructions">
      <ul>
        <li>将src/plugin/exports.ts的PluginClass设为你要开发的插件</li>
        <li>用Chrome打开本页面</li>
        <li>
          打开Chrome开发者工具：使用快捷键 Ctrl+Shift+I（Windows）或
          Cmd+Opt+I（Mac），或在页面上右键并选择“检查”(Inspect)
        </li>
        <img :class="$style.Image" :style="{maxWidth: '400px'}" src="../../../public/images/toggle_devtools.png" />
        <li>切换开发者工具到源代码“Sources”标签</li>
        <li>在文件夹目录中找到你的代码： localhost:9999/src/plugin/...</li>
        <img :class="$style.Image" src="../../../public/images/switch_to_plugin_file.png" />
        <li>点击代码左侧的行数添加断点</li>
        <img :class="$style.Image" src="../../../public/images/plugin_debug.png" />
      </ul>
    </div>
  </div>
</template>

<style lang="less" module>
.Container {
  padding: 16px;
}

.Instructions {
  line-height: 20px;
}

.Image {
  max-width: 900px;
}
</style>
