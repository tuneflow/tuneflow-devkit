<script lang="ts">
import { defineComponent, ref, computed } from 'vue';
import pluginExport from '../plugin/export';
import { createReadAPIs, getProxySocketClient } from './utils';
import _ from 'underscore';
import { ReadAPIs, TuneflowPlugin } from 'tuneflow';
import { decode as msgpackDecode, encode as msgpackEncode } from '@msgpack/msgpack';

export default defineComponent({
  setup() {
    const isRunningPlugin = ref(false);
    const { PluginClass, bundle } = pluginExport;
    const bundleInfo = bundle;
    const pluginAvailable = computed(() => PluginClass !== null && PluginClass !== undefined);
    const remoteApis = computed(() => createReadAPIs());
    const socketioClient = getProxySocketClient();
    let pluginInfo = ref(
      _.find(
        bundleInfo.plugins,
        item =>
          item.providerId === PluginClass.providerId() && item.pluginId === PluginClass.pluginId(),
      ),
    );

    const plugin = ref(null as any);
    const pluginName = pluginInfo.value
      ? remoteApis.value.translateLabel(pluginInfo.value.pluginDisplayName)
      : null;
    return {
      isRunningPlugin,
      pluginAvailable,
      socketioClient,
      remoteApis,
      plugin,
      pluginName,
      pluginInfo,
      PluginClass,
    };
  },
  mounted() {
    this.socketioClient.on('get-bundle-info', async (payload, callback) => {
      if (this.PluginClass && this.pluginInfo) {
        callback({
          status: 'OK',
          pluginInfo: {
            pluginDisplayName: this.pluginInfo.pluginDisplayName,
            pluginDescription: this.pluginInfo.pluginDescription,
            providerDisplayName: this.pluginInfo.providerDisplayName,
          },
        });
      } else {
        callback({
          status: 'PLUGIN_NOT_READY',
        });
      }
    });

    this.socketioClient.on('init-plugin', async (payload, callback) => {
      const decodedPayload: any = msgpackDecode(payload);
      if (this.PluginClass) {
        const song = await (this.remoteApis as ReadAPIs).deserializeSongFromUint8Array(
          decodedPayload.song,
        );
        this.plugin = await (this.PluginClass as typeof TuneflowPlugin).create(
          song,
          this.remoteApis,
          this.pluginInfo.options
            ? this.pluginInfo.options
            : {
                allowReset: true,
                allowManualApplyAdjust: false,
              },
        );

        callback(
          msgpackEncode({
            status: 'OK',
            paramsConfig: this.plugin.params(),
            params: this.plugin.getParamsInternal(),
          }),
        );
      } else {
        callback(msgpackEncode({
          status: 'SONG_OR_PLUGIN_NOT_READY',
        }));
      }
    });

    this.socketioClient.on('run-plugin', async (payload, callback) => {
      const decodedPayload: any = msgpackDecode(payload);
      const params = decodedPayload.params;
      const encodedSong = decodedPayload.song;
      if (this.plugin) {
        const song = await (this.remoteApis as ReadAPIs).deserializeSongFromUint8Array(encodedSong);
        this.isRunningPlugin = true;
        try {
          await this.plugin.run(song, params, this.remoteApis);
        } catch (e: any) {
          console.error(e);
          callback(
            msgpackEncode({
              status: 'RUNTIME_EXCEPTION',
            }),
          );
        }
        this.isRunningPlugin = false;

        callback(
          msgpackEncode({
            status: 'OK',
            song: await this.remoteApis.serializeSongAsUint8Array(song),
          }),
        );
      } else {
        callback(
          msgpackEncode({
            status: 'SONG_OR_PLUGIN_NOT_READY',
          }),
        );
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
        <img
          :class="$style.Image"
          :style="{ maxWidth: '400px' }"
          src="../../../public/images/toggle_devtools.png"
        />
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
