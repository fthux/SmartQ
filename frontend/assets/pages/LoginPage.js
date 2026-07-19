import { useSmartQ } from "../stores/context.js";

export const LoginPage = {
  name: "LoginPage",
  setup: useSmartQ,
  template: `<section v-if="!state.admin.token" class="relative flex h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-8">
        <div class="absolute inset-y-0 right-0 hidden w-1/2 bg-[#dff7ed] lg:block"></div>
        <div class="absolute left-[17%] top-[9%] hidden h-14 w-14 rotate-45 rounded-md border-[10px] border-emerald-400/70 lg:block"></div>
        <div class="absolute bottom-[9%] left-[30%] hidden h-20 w-20 rotate-45 rounded-md border-[10px] border-leaf/70 lg:block"></div>
        <div class="absolute right-[7%] top-[9%] hidden h-14 w-14 rounded-lg border-[10px] border-teal-300/75 lg:block"></div>

        <div class="relative z-10 grid w-full max-w-6xl overflow-hidden bg-white/80 shadow-[0_34px_85px_rgba(18,32,31,0.22)] lg:h-[calc(100vh-96px)] lg:min-h-[600px] lg:max-h-[720px] lg:grid-cols-[1fr_1fr]">
          <div class="flex min-h-[600px] flex-col items-center justify-center bg-[#f7f9fd]/95 px-6 py-10 sm:px-10 lg:min-h-0">
            <div class="mb-9 flex flex-col items-center text-center">
              <div class="relative flex h-20 w-48 flex-col items-center justify-center">
                <div class="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg bg-white p-2 shadow-lg ring-1 ring-emerald-100">
                  <img :src="publicUrl('/assets/favicon.svg')" alt="SmartQ" class="h-full w-full object-contain" />
                </div>
                <div class="mt-2 text-[11px] font-black uppercase text-slate-400">SmartQ Console</div>
              </div>
            </div>

            <form novalidate class="w-full max-w-[340px] rounded border border-slate-200 bg-white px-6 py-6 shadow-[0_10px_28px_rgba(15,23,42,0.08)]" @submit.prevent="loginAdmin">
              <label class="block text-xs font-bold text-slate-500">
                管理员账号
                <input v-model="state.admin.username" autocomplete="username" class="mt-2 h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-leaf focus:ring-2 focus:ring-emerald-100" placeholder="admin" />
              </label>
              <label class="mt-4 block text-xs font-bold text-slate-500">
                登录密码
                <input v-model="state.admin.password" type="password" autocomplete="current-password" class="mt-2 h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-leaf focus:ring-2 focus:ring-emerald-100" placeholder="请输入密码" />
              </label>
              <div class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
                <div class="flex items-center gap-2 text-leaf">
                  <i data-lucide="info" class="h-4 w-4"></i>
                  测试账号
                </div>
                <div class="mt-2 grid grid-cols-2 gap-2 text-slate-600">
                  <span>账号：admin</span>
                  <span>密码：123456</span>
                </div>
              </div>
              <div v-if="state.admin.error" class="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-coral">{{ state.admin.error }}</div>
              <button class="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded bg-leaf text-sm font-black text-white shadow-[0_8px_18px_rgba(22,167,115,0.24)] transition hover:bg-[#128a61] disabled:cursor-not-allowed disabled:opacity-50" :disabled="state.admin.loading">
                <i data-lucide="log-in" class="h-4 w-4"></i>
                {{ state.admin.loading ? '登录中' : '登录控制台' }}
              </button>
              <div class="mt-4 flex items-center justify-between text-xs font-bold text-slate-400">
                <label class="flex cursor-pointer items-center gap-2 select-none">
                  <input v-model="state.admin.rememberUsername" type="checkbox" class="h-3.5 w-3.5 rounded border-slate-300 text-leaf focus:ring-leaf" />
                  记住账号
                </label>
                <span class="text-leaf">安全登录</span>
              </div>
              <div class="mt-5 border-t border-slate-100 pt-4 text-center text-xs font-black text-leaf">SmartQ 运营控制台</div>
            </form>

            <div class="mt-auto pt-8 text-center text-[11px] font-bold text-slate-500">
              © 2026 SmartQ. All rights reserved.
            </div>
          </div>

          <div class="relative hidden min-h-[600px] overflow-hidden bg-[#e7faf1] lg:block">
            <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(236,253,245,0.82),rgba(209,250,229,0.92)),radial-gradient(circle_at_70%_28%,rgba(22,167,115,0.18),transparent_34%),linear-gradient(135deg,rgba(22,167,115,0.10)_0_1px,transparent_1px_42px)]"></div>
            <div class="absolute inset-x-0 bottom-0 h-[46%] opacity-55">
              <div class="absolute bottom-0 left-0 h-28 w-full bg-[#b7ead7]"></div>
              <div class="absolute bottom-20 left-10 h-20 w-28 bg-[#8ddfbe]"></div>
              <div class="absolute bottom-24 left-36 h-14 w-20 bg-[#a7e8d0]"></div>
              <div class="absolute bottom-20 left-60 h-24 w-32 bg-[#74d5ad]"></div>
              <div class="absolute bottom-24 right-24 h-32 w-14 bg-[#9be4c9]"></div>
              <div class="absolute bottom-24 right-44 h-24 w-12 bg-[#7cd9b4]"></div>
              <div class="absolute bottom-24 right-64 h-16 w-20 bg-[#b6edda]"></div>
              <div class="absolute bottom-12 left-20 h-6 w-64 -rotate-6 rounded-full bg-[#16a773]/35"></div>
              <div class="absolute bottom-28 left-16 h-6 w-28 bg-[#16a773]/50"></div>
              <div class="absolute bottom-28 left-48 h-6 w-28 bg-[#0f9ea8]/35"></div>
              <div class="absolute bottom-28 left-80 h-6 w-28 bg-[#16a773]/50"></div>
            </div>
            <div class="relative z-10 flex h-full min-h-[600px] items-center px-12">
              <div class="max-w-md text-ink">
                <div class="text-2xl font-medium">欢迎来到 <span class="font-black">SmartQ</span></div>
                <div class="mt-4 h-px w-80 max-w-full bg-leaf/35"></div>
                <p class="mt-6 text-base font-semibold leading-7 text-slate-600">
                  面向 AI 命题、题目审核与试卷管理的一体化控制台，让内容生产流程清晰、稳定、可追踪。
                </p>
                <div class="mt-7 inline-flex items-center gap-2 rounded border border-leaf/30 bg-white/70 px-4 py-2 text-sm font-black text-leaf shadow-sm">
                  <i data-lucide="shield-check" class="h-4 w-4 stroke-[2.6]"></i>
                  Secure console
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>`,
};
