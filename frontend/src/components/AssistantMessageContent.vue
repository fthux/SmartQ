<script setup>
import { computed } from "vue";
import { parseAssistantMarkdown, parseInlineMarkdown } from "../core/assistant-markdown.js";

const props = defineProps({ content: { type: String, default: "" } });
const blocks = computed(() => parseAssistantMarkdown(props.content));
</script>

<template>
  <div class="assistant-markdown">
    <template v-for="(block, blockIndex) in blocks" :key="`${block.type}-${blockIndex}`">
      <component :is="`h${block.level}`" v-if="block.type === 'heading'" class="markdown-heading">
        <template v-for="(token, tokenIndex) in parseInlineMarkdown(block.text)" :key="tokenIndex">
          <strong v-if="token.type === 'strong'">{{ token.text }}</strong>
          <code v-else-if="token.type === 'code'" class="markdown-inline-code">{{ token.text }}</code>
          <a v-else-if="token.type === 'link'" :href="token.href" target="_blank" rel="noopener noreferrer">{{ token.text }}</a>
          <span v-else>{{ token.text }}</span>
        </template>
      </component>

      <div v-else-if="block.type === 'table'" class="markdown-table-wrap">
        <table class="markdown-table">
          <thead>
            <tr>
              <th v-for="(cell, cellIndex) in block.header" :key="cellIndex" :style="{ textAlign: block.aligns[cellIndex] }">
                <template v-for="(token, tokenIndex) in parseInlineMarkdown(cell)" :key="tokenIndex">
                  <strong v-if="token.type === 'strong'">{{ token.text }}</strong>
                  <code v-else-if="token.type === 'code'" class="markdown-inline-code">{{ token.text }}</code>
                  <a v-else-if="token.type === 'link'" :href="token.href" target="_blank" rel="noopener noreferrer">{{ token.text }}</a>
                  <span v-else>{{ token.text }}</span>
                </template>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex" :style="{ textAlign: block.aligns[cellIndex] }">
                <template v-for="(token, tokenIndex) in parseInlineMarkdown(cell)" :key="tokenIndex">
                  <strong v-if="token.type === 'strong'">{{ token.text }}</strong>
                  <code v-else-if="token.type === 'code'" class="markdown-inline-code">{{ token.text }}</code>
                  <a v-else-if="token.type === 'link'" :href="token.href" target="_blank" rel="noopener noreferrer">{{ token.text }}</a>
                  <span v-else>{{ token.text }}</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <pre v-else-if="block.type === 'code'" class="markdown-code-block"><code>{{ block.content }}</code></pre>

      <blockquote v-else-if="block.type === 'quote'" class="markdown-quote">
        <template v-for="(line, lineIndex) in block.lines" :key="lineIndex">
          <template v-for="(token, tokenIndex) in parseInlineMarkdown(line)" :key="tokenIndex">
            <strong v-if="token.type === 'strong'">{{ token.text }}</strong>
            <code v-else-if="token.type === 'code'" class="markdown-inline-code">{{ token.text }}</code>
            <a v-else-if="token.type === 'link'" :href="token.href" target="_blank" rel="noopener noreferrer">{{ token.text }}</a>
            <span v-else>{{ token.text }}</span>
          </template>
          <br v-if="lineIndex < block.lines.length - 1" />
        </template>
      </blockquote>

      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.type === 'list'" class="markdown-list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(token, tokenIndex) in parseInlineMarkdown(item)" :key="tokenIndex">
            <strong v-if="token.type === 'strong'">{{ token.text }}</strong>
            <code v-else-if="token.type === 'code'" class="markdown-inline-code">{{ token.text }}</code>
            <a v-else-if="token.type === 'link'" :href="token.href" target="_blank" rel="noopener noreferrer">{{ token.text }}</a>
            <span v-else>{{ token.text }}</span>
          </template>
        </li>
      </component>

      <p v-else class="markdown-paragraph">
        <template v-for="(line, lineIndex) in block.lines" :key="lineIndex">
          <template v-for="(token, tokenIndex) in parseInlineMarkdown(line)" :key="tokenIndex">
            <strong v-if="token.type === 'strong'">{{ token.text }}</strong>
            <code v-else-if="token.type === 'code'" class="markdown-inline-code">{{ token.text }}</code>
            <a v-else-if="token.type === 'link'" :href="token.href" target="_blank" rel="noopener noreferrer">{{ token.text }}</a>
            <span v-else>{{ token.text }}</span>
          </template>
          <br v-if="lineIndex < block.lines.length - 1" />
        </template>
      </p>
    </template>
  </div>
</template>

<style scoped>
.assistant-markdown {
  min-width: 0;
  overflow-wrap: anywhere;
}

.markdown-paragraph,
.markdown-heading,
.markdown-list,
.markdown-quote,
.markdown-code-block,
.markdown-table-wrap {
  margin: 0 0 12px;
}

.assistant-markdown > :last-child {
  margin-bottom: 0;
}

.markdown-heading {
  color: #0f172a;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.6;
}

.markdown-list {
  padding-left: 22px;
}

.markdown-list li + li {
  margin-top: 4px;
}

.markdown-quote {
  border-left: 3px solid #10b981;
  padding-left: 10px;
  color: #64748b;
}

.markdown-table-wrap {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid #dbe4ee;
  border-radius: 6px;
}

.markdown-table {
  width: 100%;
  min-width: 540px;
  border-collapse: collapse;
  background: #ffffff;
  font-size: 13px;
  line-height: 1.45;
}

.markdown-table th,
.markdown-table td {
  padding: 9px 10px;
  border-right: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  vertical-align: top;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.markdown-table th:last-child,
.markdown-table td:last-child {
  border-right: 0;
}

.markdown-table tbody tr:last-child td {
  border-bottom: 0;
}

.markdown-table th {
  background: #f1f5f9;
  color: #334155;
  font-weight: 800;
}

.markdown-table tbody tr:nth-child(even) {
  background: #f8fafc;
}

.markdown-inline-code {
  border-radius: 4px;
  background: #e2e8f0;
  padding: 1px 5px;
  color: #0f766e;
  font-size: 0.92em;
}

.markdown-code-block {
  max-width: 100%;
  overflow-x: auto;
  border-radius: 6px;
  background: #0f172a;
  padding: 12px;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
}

.assistant-markdown a {
  color: #047857;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

:global(.dark) .markdown-heading {
  color: #e2e8f0;
}

:global(.dark) .markdown-table-wrap {
  border-color: #334155;
}

:global(.dark) .markdown-table {
  background: #111827;
}

:global(.dark) .markdown-table th,
:global(.dark) .markdown-table td {
  border-color: #334155;
}

:global(.dark) .markdown-table th {
  background: #1e293b;
  color: #e2e8f0;
}

:global(.dark) .markdown-table tbody tr:nth-child(even) {
  background: #172033;
}

:global(.dark) .markdown-inline-code {
  background: #1e293b;
  color: #6ee7b7;
}
</style>
