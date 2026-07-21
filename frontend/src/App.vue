<script setup>
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { createAppStore } from "./stores/app-store.js";
import { provideSmartQ } from "./stores/context.js";
import ConsoleShell from "./components/ConsoleShell.vue";
import GlobalOverlays from "./components/GlobalOverlays.vue";
import LoginPage from "./pages/LoginPage.vue";
import PaperPrintPage from "./pages/PaperPrintPage.vue";

const context = createAppStore();
provideSmartQ(context);
const { state } = context;
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main :class="state.admin.token ? 'min-h-screen w-full bg-[#f3f6f8] dark:bg-night-page' : 'min-h-screen w-full overflow-hidden bg-[#f2f5fa]'">
      <LoginPage v-if="!state.admin.token" />
      <PaperPrintPage v-else-if="state.route === 'paper-print'" />
      <ConsoleShell v-else />
      <GlobalOverlays v-if="state.route !== 'paper-print'" />
    </main>
  </el-config-provider>
</template>
