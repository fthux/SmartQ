<script setup>
import { Connection, EditPen, Key, Plus, Refresh, Search } from "@element-plus/icons-vue";
import { useSmartQ } from "../stores/context.js";

const {
  state,
  applyAdminUserFilters,
  changeAdminUserPage,
  changeAdminUserPageSize,
  loadAdminUsers,
  openCreateAdminUser,
  openEditAdminUser,
  openResetAdminPassword,
  resetManagedAdminPassword,
  revokeManagedAdminSessions,
  saveManagedAdminUser,
  setManagedAdminUserStatus,
  formatDateTime,
  publicUrl,
} = useSmartQ();

function statusTagType(status) {
  return status === "active" ? "success" : "info";
}
</script>

<template>
  <section class="mt-4 space-y-4">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-black">用户管理</h1>
        <div class="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">管理运营控制台账号和登录状态</div>
      </div>
      <el-button type="primary" :icon="Plus" size="large" @click="openCreateAdminUser">新建用户</el-button>
    </div>

    <el-card shadow="never" class="user-list-card">
      <div class="grid gap-3 border-b border-slate-200 pb-4 lg:grid-cols-[minmax(240px,1fr)_160px_auto] dark:border-night-border">
        <el-input
          v-model="state.userManagement.search"
          placeholder="搜索用户名或登录账号"
          clearable
          :prefix-icon="Search"
          @keyup.enter="applyAdminUserFilters"
          @clear="applyAdminUserFilters"
        />
        <el-select v-model="state.userManagement.status" placeholder="全部状态" clearable @change="applyAdminUserFilters">
          <el-option label="已启用" value="active" />
          <el-option label="已停用" value="disabled" />
        </el-select>
        <div class="flex gap-2">
          <el-button type="primary" :icon="Search" @click="applyAdminUserFilters">查询</el-button>
          <el-tooltip content="刷新列表"><el-button :icon="Refresh" circle aria-label="刷新用户列表" @click="loadAdminUsers" /></el-tooltip>
        </div>
      </div>

      <el-alert v-if="state.userManagement.error" class="mt-4" :title="state.userManagement.error" type="error" show-icon :closable="false" />

      <el-table v-loading="state.userManagement.loading" :data="state.userManagement.items" class="mt-4 w-full" empty-text="暂无匹配用户">
        <el-table-column label="用户" min-width="220">
          <template #default="{ row }">
            <div class="flex min-w-0 items-center gap-3">
              <el-avatar :size="36" shape="square" :src="row.avatar || publicUrl('/assets/favicon.svg')" class="shrink-0 bg-primary text-xs font-black text-emerald-950">
                {{ (row.displayName || row.username).slice(0, 1).toUpperCase() }}
              </el-avatar>
              <div class="min-w-0">
                <div class="truncate font-black text-ink dark:text-slate-100">
                  {{ row.displayName }}
                  <el-tag v-if="row.id === state.admin.user?.id" class="ml-1" size="small" type="info" effect="plain">当前账号</el-tag>
                </div>
                <div class="mt-1 truncate text-xs font-semibold text-slate-400">{{ row.username }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <el-switch
                :model-value="row.status"
                active-value="active"
                inactive-value="disabled"
                :loading="state.userManagement.statusUpdatingId === row.id"
                :disabled="row.id === state.admin.user?.id || state.userManagement.statusUpdatingId !== null"
                :aria-label="`${row.username}账号状态`"
                @change="setManagedAdminUserStatus(row, $event)"
              />
              <el-tag size="small" :type="statusTagType(row.status)" effect="plain">{{ row.status === "active" ? "启用" : "停用" }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="最后登录" min-width="165">
          <template #default="{ row }">{{ row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "尚未登录" }}</template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="165">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="245" align="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="EditPen" @click="openEditAdminUser(row)">编辑</el-button>
            <el-button v-if="row.id !== state.admin.user?.id" link type="warning" :icon="Key" @click="openResetAdminPassword(row)">重置密码</el-button>
            <el-button v-if="row.id !== state.admin.user?.id" link :icon="Connection" @click="revokeManagedAdminSessions(row)">下线</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex justify-end border-t border-slate-200 pt-4 dark:border-night-border">
        <el-pagination
          :current-page="state.userManagement.page"
          :page-size="state.userManagement.pageSize"
          :page-sizes="[10, 20, 50]"
          :total="state.userManagement.total"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="changeAdminUserPage"
          @size-change="changeAdminUserPageSize"
        />
      </div>
    </el-card>

    <el-dialog v-model="state.userManagement.editorOpen" :title="state.userManagement.editorMode === 'create' ? '新建用户' : '编辑用户'" width="520px" append-to-body destroy-on-close>
      <el-form label-position="top" @submit.prevent="saveManagedAdminUser">
        <el-alert v-if="state.userManagement.formError" class="mb-4" :title="state.userManagement.formError" type="error" show-icon :closable="false" />
        <el-form-item label="登录账号">
          <el-input v-model="state.userManagement.form.username" :disabled="state.userManagement.editorMode === 'edit'" maxlength="32" placeholder="例如 zhangsan" />
        </el-form-item>
        <el-form-item label="用户名">
          <el-input v-model="state.userManagement.form.displayName" maxlength="32" show-word-limit placeholder="控制台显示名称" />
        </el-form-item>
        <template v-if="state.userManagement.editorMode === 'create'">
          <el-form-item label="登录密码">
            <el-input v-model="state.userManagement.form.password" type="password" show-password autocomplete="new-password" placeholder="至少 8 位，同时包含字母和数字" />
          </el-form-item>
          <el-form-item label="确认密码">
            <el-input v-model="state.userManagement.form.confirmPassword" type="password" show-password autocomplete="new-password" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="state.userManagement.editorOpen = false">取消</el-button>
        <el-button type="primary" :loading="state.userManagement.saving" @click="saveManagedAdminUser">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="state.userManagement.resetOpen" title="重置密码" width="460px" append-to-body destroy-on-close>
      <div class="mb-4 text-sm font-semibold text-slate-500 dark:text-slate-400">为 {{ state.userManagement.resetUser?.displayName }} 设置新的登录密码</div>
      <el-alert v-if="state.userManagement.resetError" class="mb-4" :title="state.userManagement.resetError" type="error" show-icon :closable="false" />
      <el-form label-position="top" @submit.prevent="resetManagedAdminPassword">
        <el-form-item label="新密码"><el-input v-model="state.userManagement.resetPassword" type="password" show-password autocomplete="new-password" placeholder="至少 8 位，同时包含字母和数字" /></el-form-item>
        <el-form-item label="确认密码"><el-input v-model="state.userManagement.resetPasswordConfirm" type="password" show-password autocomplete="new-password" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="state.userManagement.resetOpen = false">取消</el-button>
        <el-button type="primary" :loading="state.userManagement.resetting" @click="resetManagedAdminPassword">确认重置</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.user-list-card :deep(.el-card__body) {
  padding: 16px;
}

@media (max-width: 640px) {
  .user-list-card :deep(.el-pagination) {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
