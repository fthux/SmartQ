<script setup>
import { Upload } from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const { state, adminDisplayName, saveAdminProfile, selectAdminAvatar, changeAdminPassword, go } = useSmartQ();
</script>

<template>
  <section class="mx-auto mt-4 max-w-4xl">
    <div class="border-b border-slate-200 pb-4 dark:border-night-border">
      <h1 class="text-2xl font-black text-ink dark:text-slate-100">个人资料</h1>
      <div class="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">管理控制台中显示的用户信息</div>
    </div>

    <el-alert
      v-if="state.admin.user?.mustChangePassword"
      class="mt-5"
      title="当前使用的是初始密码，修改密码后才能进入其他功能"
      type="warning"
      :closable="false"
      show-icon
    />

    <el-form class="mt-5" label-position="top" @submit.prevent="saveAdminProfile">
      <div class="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div class="border-b border-slate-200 pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6 dark:border-night-border">
          <div class="text-xs font-black text-slate-500 dark:text-slate-400">用户头像</div>
          <div class="mt-3 flex items-center gap-4 lg:flex-col lg:items-start">
            <el-avatar :size="96" shape="square" :src="state.profile.avatarPreview || undefined" class="bg-primary text-2xl font-black text-emerald-950">
              {{ adminDisplayName.slice(0, 1).toUpperCase() }}
            </el-avatar>
            <div>
              <el-upload :auto-upload="false" :show-file-list="false" accept="image/png,image/jpeg,image/webp" :on-change="selectAdminAvatar">
                <el-button :icon="Upload" :loading="state.profile.uploadingAvatar">上传头像</el-button>
              </el-upload>
              <div class="mt-2 text-[11px] font-semibold leading-5 text-slate-400">PNG / JPG / WebP · 正方形 · ≤ 100KB</div>
            </div>
          </div>
        </div>

        <div class="min-w-0">
          <el-form-item label="用户名" :error="state.profile.error">
            <el-input v-model="state.profile.displayName" maxlength="32" show-word-limit placeholder="请输入用户名" />
          </el-form-item>
          <el-form-item label="登录账号">
            <el-input :model-value="state.admin.user?.username || state.admin.username" disabled />
          </el-form-item>
          <div class="mt-6 flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-night-border">
            <el-button v-if="!state.admin.user?.mustChangePassword" @click="go('papers')">取消</el-button>
            <el-button type="primary" native-type="submit" :loading="state.profile.saving" :disabled="state.profile.uploadingAvatar">保存资料</el-button>
          </div>
        </div>
      </div>
    </el-form>

    <div class="mt-8 border-t border-slate-200 pt-6 dark:border-night-border">
      <div class="text-lg font-black text-ink dark:text-slate-100">修改密码</div>
      <div class="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">更新后会注销当前账号的其他登录会话</div>
      <el-form class="mt-5 max-w-xl" label-position="top" @submit.prevent="changeAdminPassword">
        <el-alert v-if="state.password.error" class="mb-4" :title="state.password.error" type="error" :closable="false" show-icon />
        <el-form-item label="当前密码">
          <el-input v-model="state.password.currentPassword" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="state.password.newPassword" type="password" show-password autocomplete="new-password" placeholder="至少 8 位，同时包含字母和数字" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="state.password.confirmPassword" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <div class="flex justify-end border-t border-slate-200 pt-4 dark:border-night-border">
          <el-button type="primary" native-type="submit" :loading="state.password.saving">更新密码</el-button>
        </div>
      </el-form>
    </div>
  </section>
</template>
