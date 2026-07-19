import { AuthoringPage } from "../pages/AuthoringPage.js";
import { PapersPage } from "../pages/PapersPage.js";
import { PaperDetailDrawer } from "./PaperDetailDrawer.js";

import { useSmartQ } from "../stores/context.js";

export const ConsoleShell = {
  name: "ConsoleShell",
  components: { AuthoringPage, PapersPage, PaperDetailDrawer },
  setup: useSmartQ,
  template: `<div class="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside class="border-b border-slate-800 bg-ink text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
          <div class="flex h-16 items-center justify-between gap-3 px-4 lg:h-auto lg:px-5 lg:py-6">
            <button class="flex min-w-0 items-center gap-3 text-left" @click="go('papers')">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5 shadow-sm">
                <img :src="publicUrl('/assets/favicon.svg')" alt="SmartQ" class="h-full w-full object-contain" />
              </span>
              <span class="min-w-0">
                <span class="block truncate text-lg font-black">SmartQ</span>
                <span class="block truncate text-[11px] font-semibold text-slate-400">考试与测评管理平台</span>
              </span>
            </button>
            <span class="rounded bg-emerald-400/10 px-2 py-1 text-[10px] font-black text-emerald-300 lg:hidden">控制台</span>
          </div>

          <nav class="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:px-4 lg:pb-4" aria-label="管理功能导航">
            <button
              v-for="item in visibleNavItems"
              :key="item.key"
              type="button"
              class="group flex h-11 shrink-0 items-center gap-3 rounded px-3 text-left text-sm font-bold transition lg:w-full"
              :class="state.route === item.key ? 'bg-white text-ink shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white'"
              @click="go(item.key)"
            >
              <i :data-lucide="item.icon" class="h-4 w-4 shrink-0" :class="state.route === item.key ? 'text-leaf' : 'text-slate-500 group-hover:text-slate-300'"></i>
              <span class="whitespace-nowrap">{{ item.label }}</span>
            </button>
          </nav>

          <div data-admin-account-menu class="relative hidden border-t border-white/10 p-4 lg:block">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded px-2 py-2 text-left transition hover:bg-white/10"
              :aria-expanded="state.admin.menuOpen ? 'true' : 'false'"
              aria-haspopup="menu"
              @click.stop="toggleAdminMenu"
            >
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-emerald-400/15 text-sm font-black text-emerald-300">{{ adminDisplayName.slice(0, 1).toUpperCase() }}</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-black text-white">{{ adminDisplayName }}</span>
                <span class="mt-0.5 block text-[11px] font-semibold text-slate-400">管理员账号</span>
              </span>
              <i data-lucide="chevrons-up-down" class="h-4 w-4 text-slate-500"></i>
            </button>
            <div
              v-if="state.admin.menuOpen"
              class="absolute bottom-4 left-full z-40 ml-2 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-2 text-ink shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
              role="menu"
            >
              <div class="border-b border-slate-100 px-3 pb-2 pt-1">
                <div class="text-[11px] font-bold text-slate-400">当前账号</div>
                <div class="mt-1 truncate text-sm font-black">{{ adminDisplayName }}</div>
              </div>
              <button
                v-for="item in adminAccountMenuItems"
                :key="item.key"
                type="button"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold transition"
                :class="item.tone === 'danger' ? 'text-coral hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'"
                role="menuitem"
                @click="runAdminAccountMenuItem(item)"
              >
                <i :data-lucide="item.icon" class="h-4 w-4"></i>
                <span>{{ item.label }}</span>
              </button>
            </div>
          </div>
        </aside>

        <div class="min-w-0 px-4 pb-8 pt-4 sm:px-6 lg:px-8 lg:pb-10 lg:pt-6">
          <header class="flex min-h-14 items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white text-leaf shadow-sm ring-1 ring-slate-200">
                <i :data-lucide="currentNavItem.icon" class="h-4 w-4"></i>
              </span>
              <div class="min-w-0">
                <div class="truncate text-base font-black text-ink">{{ currentNavItem.label }}</div>
                <div class="mt-0.5 text-xs font-semibold text-slate-500">SmartQ 运营控制台</div>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2 lg:hidden">
              <span class="max-w-28 truncate text-xs font-bold text-slate-500">{{ adminDisplayName }}</span>
              <button type="button" title="退出登录" class="flex h-9 w-9 items-center justify-center rounded border border-slate-200 bg-white text-slate-600" @click="logoutAdmin">
                <i data-lucide="log-out" class="h-4 w-4"></i>
              </button>
            </div>
          </header>

          <div v-if="state.loading && !state.dashboard" class="mt-6 rounded-lg border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500 shadow-soft">
            控制台数据加载中...
          </div>
          <div v-else-if="state.dashboardError && !state.dashboard" class="mt-6 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-coral shadow-soft">
            <span>{{ state.dashboardError }}</span>
            <button class="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-black text-coral" @click="refresh">重试</button>
          </div>

          <div v-else data-admin-route-content>
        <AuthoringPage v-if="state.route === 'authoring'" />
        <PapersPage v-if="state.route === 'papers'" />
        <PaperDetailDrawer />

          </div>
        </div>
      </div>`,
};
