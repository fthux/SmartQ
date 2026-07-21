<script setup>
import {
  ArrowDown,
  Check,
  Collection,
  Expand,
  Files,
  FolderOpened,
  Fold,
  FullScreen,
  Loading,
  MagicStick,
  Management,
  Monitor,
  Moon,
  ScaleToOriginal,
  Sunny,
  SwitchButton,
  User,
} from "@element-plus/icons-vue";
import { SMARTQ_BRAND } from "../core/brand.js";
import AuthoringPage from "../pages/AuthoringPage.vue";
import MaterialsPage from "../pages/MaterialsPage.vue";
import PapersPage from "../pages/PapersPage.vue";
import QuestionBankPage from "../pages/QuestionBankPage.vue";
import ProfilePage from "../pages/ProfilePage.vue";
import UsersPage from "../pages/UsersPage.vue";
import PaperDetailDrawer from "./PaperDetailDrawer.vue";
import SmartQAssistantTrigger from "./SmartQAssistantTrigger.vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  visibleNavItems,
  currentNavItem,
  adminDisplayName,
  adminAccountMenuItems,
  themeOptions,
  go,
  refresh,
  toggleSidebar,
  setTheme,
  toggleTheme,
  toggleFullscreen,
  runAdminAccountMenuItem,
  publicUrl,
  openAssistant,
} = useSmartQ();

const iconMap = {
  files: Files,
  sparkles: MagicStick,
  collection: Collection,
  folder: FolderOpened,
  "user-round": User,
  users: Management,
};

const themeIconMap = { system: Monitor, light: Sunny, dark: Moon };

function handleAdminCommand(key) {
  const item = adminAccountMenuItems.value.find((entry) => entry.key === key);
  runAdminAccountMenuItem(item);
}

function handleThemeToggle(isDark) {
  toggleTheme(isDark);
}

function handleThemePreference(theme) {
  setTheme(theme, { animate: true });
}
</script>

<template>
  <div class="min-h-screen transition-[grid-template-columns] duration-200 lg:grid" :class="state.ui.sidebarCollapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[232px_minmax(0,1fr)]'">
    <aside
      class="app-sidebar hidden bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col dark:bg-night-sidebar"
      :class="state.ui.sidebarCollapsed ? '' : 'border-r border-slate-200 dark:border-night-border'"
    >
      <div class="flex h-14 items-center px-3" :class="state.ui.sidebarCollapsed ? 'justify-center' : ''">
        <el-button text class="brand-button min-w-0" :title="SMARTQ_BRAND.name" @click="go('papers')">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-emerald-50 p-1.5 shadow-sm dark:bg-white">
            <img :src="publicUrl('/assets/favicon.svg')" :alt="SMARTQ_BRAND.name" class="h-full w-full object-contain" />
          </span>
          <span v-if="!state.ui.sidebarCollapsed" class="min-w-0">
            <span class="block truncate text-base font-black">{{ SMARTQ_BRAND.name }}</span>
            <span class="block truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">{{ SMARTQ_BRAND.slogan }}</span>
          </span>
        </el-button>
      </div>

      <el-menu
        class="smartq-menu flex-1 border-r-0 px-2 py-3"
        :default-active="state.route"
        :collapse="state.ui.sidebarCollapsed"
        aria-label="管理功能导航"
        @select="(index) => go(index)"
      >
        <el-menu-item v-for="item in visibleNavItems" :key="item.key" :index="item.key">
          <el-icon><component :is="iconMap[item.icon]" /></el-icon>
          <template #title>{{ item.label }}</template>
        </el-menu-item>
      </el-menu>
    </aside>

    <div class="min-w-0">
      <header class="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-4 lg:px-5 dark:border-night-border dark:bg-night-surface/95">
        <div class="flex min-w-0 items-center gap-2">
          <el-tooltip :content="state.ui.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'">
            <el-button
              class="hidden lg:inline-flex"
              :icon="state.ui.sidebarCollapsed ? Expand : Fold"
              circle
              :aria-label="state.ui.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
              @click="toggleSidebar"
            />
          </el-tooltip>
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary text-emerald-950 lg:hidden">
            <el-icon><component :is="iconMap[currentNavItem.icon]" /></el-icon>
          </span>
          <div class="min-w-0 truncate text-sm font-black sm:text-base">{{ currentNavItem.label }}</div>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          <el-tooltip :content="state.ui.isFullscreen ? '退出全屏' : '全屏展示'">
            <el-button
              :icon="state.ui.isFullscreen ? ScaleToOriginal : FullScreen"
              circle
              :aria-label="state.ui.isFullscreen ? '退出全屏' : '全屏展示'"
              @click="toggleFullscreen"
            />
          </el-tooltip>

          <div class="theme-control" data-theme-control>
            <el-tooltip :content="state.ui.isDark ? '切换为浅色主题' : '切换为深色主题'">
              <el-switch
                class="theme-switch"
                :model-value="state.ui.isDark"
                :active-action-icon="Moon"
                :inactive-action-icon="Sunny"
                :aria-label="state.ui.isDark ? '切换为浅色主题' : '切换为深色主题'"
                @change="handleThemeToggle"
              />
            </el-tooltip>
            <el-dropdown trigger="click" @command="handleThemePreference">
              <el-button text circle size="small" class="theme-preference-button" aria-label="主题偏好">
                <el-icon><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="option in themeOptions" :key="option.value" :command="option.value">
                    <el-icon><component :is="themeIconMap[option.value]" /></el-icon>
                    <span class="mr-5">{{ option.label }}</span>
                    <el-icon v-if="state.ui.theme === option.value"><Check /></el-icon>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <el-dropdown trigger="click" @command="handleAdminCommand">
            <el-button text class="account-button h-10">
              <el-avatar :size="32" shape="square" :src="state.admin.user?.avatar || publicUrl('/assets/default_avatar.jpg')" class="bg-primary text-xs font-black text-emerald-950">{{ adminDisplayName.slice(0, 1).toUpperCase() }}</el-avatar>
              <span class="ml-2 hidden max-w-28 truncate text-xs font-black sm:block">{{ adminDisplayName }}</span>
              <el-icon class="hidden text-slate-400 sm:inline-flex"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>
                  <div class="min-w-44 py-1">
                    <div class="truncate text-sm font-black">{{ adminDisplayName }}</div>
                    <div class="mt-0.5 truncate text-[11px] text-slate-400">{{ state.admin.user?.username || state.admin.username }}</div>
                  </div>
                </el-dropdown-item>
                <el-dropdown-item v-for="item in adminAccountMenuItems" :key="item.key" :command="item.key" :divided="item.key === 'logout'">
                  <el-icon><User v-if="item.key === 'profile'" /><SwitchButton v-else /></el-icon>
                  <span :class="item.tone === 'danger' ? 'text-coral' : ''">{{ item.label }}</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <nav class="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:hidden dark:border-night-border dark:bg-night-surface" aria-label="移动端管理功能导航">
        <el-button v-for="item in visibleNavItems" :key="item.key" :type="state.route === item.key ? 'primary' : 'default'" :plain="state.route !== item.key" @click="go(item.key)">
          <el-icon><component :is="iconMap[item.icon]" /></el-icon>{{ item.label }}
        </el-button>
      </nav>

      <main class="min-w-0 px-3 pb-6 sm:px-4 lg:px-5">
        <div v-if="state.loading && !state.dashboard" class="flex min-h-64 items-center justify-center"><el-icon class="is-loading mr-2"><Loading /></el-icon>控制台数据加载中...</div>
        <el-alert v-else-if="state.dashboardError && !state.dashboard" class="mt-4" :title="state.dashboardError" type="error" show-icon :closable="false">
          <template #default><el-button class="mt-2" size="small" @click="refresh">重试</el-button></template>
        </el-alert>
        <div v-else data-admin-route-content>
          <AuthoringPage v-if="state.route === 'authoring'" />
          <PapersPage v-if="state.route === 'papers'" />
          <QuestionBankPage v-if="state.route === 'question-bank'" />
          <MaterialsPage v-if="state.route === 'materials'" />
          <UsersPage v-if="state.route === 'users'" />
          <ProfilePage v-if="state.route === 'profile'" />
          <PaperDetailDrawer />
        </div>
      </main>
    </div>

    <SmartQAssistantTrigger
      :active="state.assistant.open"
      :busy="state.assistant.loading || state.assistant.sending"
      :error="Boolean(state.assistant.error)"
      @activate="openAssistant"
    />
  </div>
</template>

<style scoped>
.smartq-menu {
  --el-menu-bg-color: transparent;
  --el-menu-hover-bg-color: var(--el-color-primary-light-9);
  --el-menu-active-color: #166534;
}

.smartq-menu:not(.el-menu--collapse) {
  width: 100%;
}

.smartq-menu :deep(.el-menu-item) {
  height: 40px;
  margin-bottom: 4px;
  border-radius: 6px;
  font-weight: 700;
}

.smartq-menu :deep(.el-menu-item.is-active) {
  background: #dcfce7;
}

.brand-button,
.account-button {
  justify-content: flex-start;
  padding: 4px 6px;
  color: inherit;
}

.brand-button {
  height: auto;
}

.theme-control {
  display: flex;
  width: 64px;
  height: 32px;
  align-items: center;
}

.theme-switch {
  --el-switch-on-color: #2c2c2c;
  --el-switch-off-color: #e5e7eb;
  flex: 0 0 40px;
}

.theme-switch :deep(.el-switch__core) {
  border-color: var(--el-border-color);
  transition: border-color 0.3s, background-color 0.3s;
}

.theme-switch :deep(.el-switch__action) {
  color: #d89a16;
  transition: left 0.3s, transform 0.3s, color 0.3s;
}

.theme-switch.is-checked :deep(.el-switch__action) {
  color: #475569;
}

.theme-switch :deep(.el-icon) {
  font-size: 14px;
}

.theme-preference-button {
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--el-text-color-secondary);
}
</style>
