import { describe, expect, it } from 'vitest'
import { evaluateDeployment, findAssetScript } from './deployedHeaders.mjs'

const html =
  '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-abc.js"></script>' +
  '<link rel="modulepreload" crossorigin href="/assets/ui-def.js"></head><body><div id="root"></div></body></html>'

/** spec D §5.2 をすべて満たす、索引される（独自ドメインの）応答 */
function passing() {
  return {
    root: {
      status: 200,
      headers: {
        'content-security-policy': "default-src 'self'; script-src 'self'",
        'x-content-type-options': 'nosniff',
        'cache-control': 'public, max-age=0, must-revalidate',
      },
      body: html,
    },
    asset: {
      status: 200,
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
      body: '',
    },
    buildInfo: { status: 200, headers: {}, body: html },
    fallback: { status: 200, headers: {}, body: html },
  }
}

describe('findAssetScript', () => {
  it('index.html の最初の /assets/*.js の script を返す', () => {
    expect(findAssetScript(html)).toBe('/assets/index-abc.js')
  })

  it('無ければ undefined', () => {
    expect(findAssetScript('<html><body></body></html>')).toBeUndefined()
  })
})

describe('evaluateDeployment', () => {
  it('すべて満たせば違反なし（索引される）', () => {
    expect(evaluateDeployment(passing(), { noindex: false })).toEqual([])
  })

  it('*.pages.dev で x-robots-tag: noindex があれば違反なし', () => {
    const responses = passing()
    responses.root.headers['x-robots-tag'] = 'noindex'
    expect(evaluateDeployment(responses, { noindex: true })).toEqual([])
  })

  it('noindex を期待して x-robots-tag が無ければ違反', () => {
    const violations = evaluateDeployment(passing(), { noindex: true })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('x-robots-tag')
  })

  it('索引されるべきなのに noindex が付いていれば違反', () => {
    const responses = passing()
    responses.root.headers['x-robots-tag'] = 'noindex'
    const violations = evaluateDeployment(responses, { noindex: false })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('noindex')
  })

  it('/ が 200 でなければ違反', () => {
    const responses = passing()
    responses.root.status = 500
    expect(evaluateDeployment(responses, { noindex: false }).join('\n')).toContain('500')
  })

  it('CSP・nosniff が無ければそれぞれ違反', () => {
    const responses = passing()
    delete responses.root.headers['content-security-policy']
    delete responses.root.headers['x-content-type-options']
    const violations = evaluateDeployment(responses, { noindex: false })
    expect(violations).toHaveLength(2)
    expect(violations.join('\n')).toContain('content-security-policy')
    expect(violations.join('\n')).toContain('x-content-type-options')
  })

  it('/ の cache-control に immutable があれば違反（RB-1）', () => {
    const responses = passing()
    responses.root.headers['cache-control'] = 'public, max-age=31536000, immutable'
    expect(evaluateDeployment(responses, { noindex: false }).join('\n')).toContain('immutable')
  })

  it('/assets/*.js が長期キャッシュでなければ違反', () => {
    const responses = passing()
    responses.asset.headers['cache-control'] = 'public, max-age=0, must-revalidate'
    expect(evaluateDeployment(responses, { noindex: false }).join('\n')).toContain('/assets/')
  })

  it('/assets/*.js の script が見つからなければ違反', () => {
    const responses = passing()
    responses.asset = undefined
    expect(evaluateDeployment(responses, { noindex: false }).join('\n')).toContain('/assets/')
  })

  it('/.vite/manifest.json がビルドの情報を返せば違反', () => {
    const responses = passing()
    responses.buildInfo.body = '{"index.html":{"file":"assets/index-abc.js","isEntry":true}}'
    expect(evaluateDeployment(responses, { noindex: false }).join('\n')).toContain('/.vite/')
  })

  it('無いパスが 200 で / と同じ本文でなければ違反（SPA のフォールバック）', () => {
    const notFound = passing()
    notFound.fallback = { status: 404, headers: {}, body: 'Not Found' }
    expect(evaluateDeployment(notFound, { noindex: false }).join('\n')).toContain('/no-such-path')
    const otherBody = passing()
    otherBody.fallback.body = '<html>404</html>'
    expect(evaluateDeployment(otherBody, { noindex: false }).join('\n')).toContain('/no-such-path')
  })
})
