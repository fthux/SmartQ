<script setup>
import { InfoFilled, Lock, User } from "@element-plus/icons-vue";
import { SMARTQ_BRAND } from "../core/brand.js";
import { useSmartQ } from "../stores/context.js";

const { state, loginAdmin, publicUrl } = useSmartQ();
</script>

<template>
    <section class="relative flex min-h-screen items-center justify-center overflow-x-hidden overflow-y-auto px-4 py-8 sm:px-8">
    <div class="absolute inset-y-0 right-0 hidden w-1/2 bg-emerald-100 lg:block dark:bg-night-sidebar"></div>
    <div class="absolute left-[17%] top-[9%] hidden h-14 w-14 rotate-45 rounded-md border-[10px] border-emerald-400/70 lg:block"></div>
    <div class="absolute bottom-[9%] left-[30%] hidden h-20 w-20 rotate-45 rounded-md border-[10px] border-leaf/70 lg:block"></div>
    <div class="absolute right-[7%] top-[9%] hidden h-14 w-14 rounded-lg border-[10px] border-teal-300/75 lg:block"></div>

    <div class="relative z-10 grid w-full max-w-6xl overflow-hidden bg-white/80 shadow-[0_34px_85px_rgba(18,32,31,0.22)] lg:h-[calc(100vh-96px)] lg:min-h-[600px] lg:max-h-[720px] lg:grid-cols-2 dark:bg-night-surface/90">
      <div class="flex min-h-[600px] flex-col items-center justify-center bg-[#f7f9fd]/95 px-6 py-10 sm:px-10 lg:min-h-0 dark:bg-night-surface/95">
        <div class="mb-9 flex flex-col items-center text-center">
          <div class="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg bg-white p-2 shadow-lg ring-1 ring-emerald-100">
            <img :src="publicUrl('/assets/favicon.svg')" :alt="SMARTQ_BRAND.name" class="h-full w-full object-contain" />
          </div>
          <div class="mt-3 text-base font-black text-ink dark:text-slate-100">{{ SMARTQ_BRAND.name }}</div>
          <div class="mt-1 text-[11px] font-semibold text-slate-400">{{ SMARTQ_BRAND.slogan }}</div>
        </div>

        <el-card class="w-full max-w-[360px]" shadow="always">
          <el-form label-position="top" @submit.prevent="loginAdmin">
            <el-form-item label="登录账号">
              <el-input v-model="state.admin.username" autocomplete="username" placeholder="请输入登录账号" size="large" :prefix-icon="User" />
            </el-form-item>
            <el-form-item label="登录密码">
              <el-input v-model="state.admin.password" type="password" autocomplete="current-password" placeholder="请输入密码" show-password size="large" :prefix-icon="Lock" />
            </el-form-item>

            <el-alert v-if="state.admin.error" class="mb-4" :title="state.admin.error" type="error" :closable="false" show-icon />

            <el-button class="w-full" type="primary" size="large" native-type="submit" :loading="state.admin.loading">
              登录控制台
            </el-button>

            <div class="mt-4 flex items-center justify-between">
              <el-checkbox v-model="state.admin.rememberUsername">记住账号</el-checkbox>
              <span class="inline-flex items-center gap-1 text-xs font-bold text-leaf"><el-icon><InfoFilled /></el-icon>仅限授权用户</span>
            </div>
          </el-form>
        </el-card>

        <div class="mt-auto pt-8 text-center text-[11px] font-bold text-slate-500 dark:text-slate-400">© 2026 {{ SMARTQ_BRAND.name }}</div>
      </div>

      <div class="relative hidden min-h-[600px] overflow-hidden bg-[#e7faf1] lg:block dark:bg-night-sidebar">
        <div class="login-art-overlay absolute inset-0"></div>
        <div class="login-art-skyline absolute inset-x-0 bottom-0 h-[46%] opacity-55">
          <div class="absolute bottom-0 left-0 h-28 w-full bg-[#b7ead7]"></div>
          <div class="absolute bottom-20 left-10 h-20 w-28 bg-[#8ddfbe]"></div>
          <div class="absolute bottom-24 left-36 h-14 w-20 bg-[#a7e8d0]"></div>
          <div class="absolute bottom-20 left-60 h-24 w-32 bg-[#74d5ad]"></div>
          <div class="absolute bottom-24 right-24 h-32 w-14 bg-[#9be4c9]"></div>
          <div class="absolute bottom-24 right-44 h-24 w-12 bg-[#7cd9b4]"></div>
          <div class="absolute bottom-24 right-64 h-16 w-20 bg-[#b6edda]"></div>
        </div>
        <div class="relative z-10 flex h-full min-h-[600px] items-center px-12">
          <div class="max-w-md text-ink dark:text-slate-100">
            <div class="text-2xl font-medium">欢迎来到 <span class="font-black">{{ SMARTQ_BRAND.name }}</span></div>
            <div class="mt-4 h-px w-80 max-w-full bg-leaf/35"></div>
            <p class="mt-6 text-base font-semibold leading-7 text-slate-600 dark:text-slate-300">面向 AI 命题、题目编辑与试卷管理的一体化控制台，让内容生产流程清晰、稳定、可追踪。</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.login-art-overlay {
  background:
    linear-gradient(180deg, rgba(236, 253, 245, 0.82), rgba(209, 250, 229, 0.92)),
    radial-gradient(circle at 70% 28%, rgba(22, 167, 115, 0.18), transparent 34%),
    linear-gradient(135deg, rgba(22, 167, 115, 0.1) 0 1px, transparent 1px 42px);
}
</style>
