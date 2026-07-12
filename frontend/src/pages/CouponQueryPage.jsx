import { useState, useEffect, useRef } from 'react'
import { couponsApi, accountsApi } from '../api'
import { Play, Download, Trash2, RefreshCw, Database, ArrowRight } from 'lucide-react'
import { useDataStore } from '../stores/dataStore'
import { useToastStore } from '../stores/toastStore'
import { getErrorMessage, isAbortError } from '../utils/requestFeedback'
import { createErrorQueryResult, createSuccessQueryResult, QUERY_RESULT_STATUS } from '../utils/queryResult'
import CouponQueryResultDialog from '../components/CouponQueryResultDialog'

function CouponQueryPage() {
  const {
    accounts,
    accountsLoaded,
    fetchAccounts,
    couponQueryResults: storedResults,
    couponQueryCodes: storedCodes,
    setCouponQueryData,
    clearCouponQueryData
  } = useDataStore()
  const toast = useToastStore()

  const [couponCodes, setCouponCodes] = useState(storedCodes || '')
  const [results, setResults] = useState(storedResults || [])
  const [querySummary, setQuerySummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [backendLoading, setBackendLoading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const couponResultsRequestIdRef = useRef(0)
  const couponResultsAbortControllerRef = useRef(null)
  const couponDialogRequestIdRef = useRef(0)

  // 详情弹窗状态
  const [couponDialogOpen, setCouponDialogOpen] = useState(false)
  const [couponDialogResult, setCouponDialogResult] = useState(null)
  const [couponDialogMeta, setCouponDialogMeta] = useState(null)
  const [couponDialogLoading, setCouponDialogLoading] = useState(false)
  const [couponDialogTitle, setCouponDialogTitle] = useState('')
  const [couponDialogRefreshFn, setCouponDialogRefreshFn] = useState(null)

  useEffect(() => {
    if (!accountsLoaded) {
      fetchAccounts(accountsApi)
    }
  }, [accountsLoaded, fetchAccounts])

  useEffect(() => {
    setCouponQueryData(results, couponCodes)
  }, [results, couponCodes])

  useEffect(() => {
    return () => {
      couponResultsAbortControllerRef.current?.abort()
      couponResultsRequestIdRef.current += 1
      couponDialogRequestIdRef.current += 1
    }
  }, [])

  const getCouponDialogOrderInfo = (result) => {
    const orderId = result.order_view_id && result.order_view_id !== '-' ? String(result.order_view_id).trim() : ''
    const giftId = result.gift_id && result.gift_id !== '-' ? String(result.gift_id).trim() : ''
    const queryOrderId = giftId || orderId
    const isGiftId = Boolean(giftId) || queryOrderId.length > 20 || /^[a-zA-Z]/.test(queryOrderId)

    return {
      queryOrderId,
      isGiftId,
      title: orderId ? `订单 ${orderId}` : giftId ? `礼物 ${giftId}` : `券码 ${result.current_coupon_code || result.coupon_code || '-'}`
    }
  }

  const findAccountForResult = async (result) => {
    const availableAccounts = accountsLoaded ? accounts : await fetchAccounts(accountsApi)
    const accountId = parseInt(result.account_id, 10)

    return availableAccounts.find(account => account.id === accountId) ||
      availableAccounts.find(account => String(account.userid) === String(result.userid))
  }

  const handleShowDetail = async (result) => {
    const { queryOrderId, isGiftId, title } = getCouponDialogOrderInfo(result)

    if (!queryOrderId) {
      toast.warning('当前结果缺少订单号或礼物号，无法查询券码')
      return
    }

    const requestId = ++couponDialogRequestIdRef.current
    setCouponDialogOpen(true)
    setCouponDialogLoading(true)
    setCouponDialogResult(null)
    setCouponDialogMeta(null)
    setCouponDialogTitle(title)
    setCouponDialogRefreshFn(() => () => handleShowDetail(result))

    try {
      const account = await findAccountForResult(result)

      if (!account?.userid || !account?.token) {
        toast.warning('当前账号缺少必要信息(userid/token)，请先在账号管理中完善')
        if (requestId === couponDialogRequestIdRef.current) {
          setCouponDialogResult(createErrorQueryResult({
            source: 'frontend',
            message: '当前账号缺少必要信息(userid/token)，无法查询券码'
          }))
        }
        return
      }

      const meituanResult = await window.electronAPI.rebateQueryOne({
        account: {
          userid: account.userid,
          token: account.token,
          csecuuid: account.csecuuid || '',
          openId: account.open_id || '',
          openIdCipher: account.open_id_cipher || '',
          platform: account.platform || 'android'
        },
        orderId: queryOrderId,
        isGiftId
      })

      if (requestId !== couponDialogRequestIdRef.current) return

      if (meituanResult.success && meituanResult.data?.response) {
        const coupons = Array.isArray(meituanResult.data.response?.data) ? meituanResult.data.response.data : []
        setCouponDialogResult(createSuccessQueryResult({
          source: 'frontend',
          coupons,
          message: coupons.length > 0 ? `查询成功，获取到 ${coupons.length} 个券码` : '未查询到券码信息'
        }))
        setCouponDialogMeta({ source: 'live' })
      } else {
        const errorMessage = getErrorMessage(meituanResult, '未知错误')
        setCouponDialogResult(createErrorQueryResult({
          source: 'frontend',
          message: `查询失败: ${errorMessage}`
        }))
        toast.error('查询失败: ' + errorMessage)
      }
    } catch (error) {
      if (requestId !== couponDialogRequestIdRef.current) return
      const errorMessage = getErrorMessage(error, '未知错误')
      setCouponDialogResult(createErrorQueryResult({
        source: 'frontend',
        message: `查询失败: ${errorMessage}`
      }))
      toast.error('查询失败: ' + errorMessage)
    } finally {
      if (requestId === couponDialogRequestIdRef.current) {
        setCouponDialogLoading(false)
      }
    }
  }

  const handleCloseDetail = () => {
    couponDialogRequestIdRef.current += 1
    setCouponDialogOpen(false)
    setCouponDialogResult(null)
    setCouponDialogMeta(null)
    setCouponDialogLoading(false)
    setCouponDialogRefreshFn(null)
  }

  const normalizeCouponQueryRow = (row) => ({
    id: `${row.coupon_code || row.current_coupon_code || 'unknown'}:${row.order_view_id || row.gift_id || '-'}`,
    raw: row,
    couponCode: row.coupon_code || '-',
    currentCouponCode: row.current_coupon_code || row.coupon_code || '-',
    displayOrderId: row.order_view_id || '-',
    displayGiftId: row.gift_id || '-',
    userId: row.userid || '-',
    couponStatus: row.coupon_status || '-',
    verifyTime: row.verify_time || '-',
    verifyPoiName: row.verify_poi_name || '-',
    queryStatus: row.status || 'unknown',
    changeType: row.change_type || 'none',
    oldCouponCode: row.old_coupon_code || '',
    changeCount: row.change_count || 0,
    isOldCode: Boolean(row.is_old_code),
    codeChanged: Boolean(row.code_changed)
  })

  const normalizedResults = results.map(normalizeCouponQueryRow)

  const handleCopy = async (result) => {
    const lines = [`券码：${result.current_coupon_code || result.coupon_code}`]

    if (result.old_coupon_code) {
      lines.push(`原券码：${result.old_coupon_code}（已变更）`)
    }

    lines.push(`券码状态：${result.coupon_status || '-'}`)

    if (result.verify_time) {
      lines.push(`核销时间：${result.verify_time}`)
    }
    if (result.verify_poi_name) {
      lines.push(`核销门店：${result.verify_poi_name}`)
    }

    const orderId = result.order_view_id !== '-' ? result.order_view_id : result.gift_id
    const orderLabel = result.gift_id !== '-' ? '礼物号' : '订单号'
    lines.push(`${orderLabel}：${orderId || '-'}`)
    lines.push(`MTUserID：${result.userid || '-'}`)

    if (result.code_changed) {
      lines.push(`变更类型：${getChangeTypeText(result.change_type)}`)
    }
    if (result.change_count > 0) {
      lines.push(`历史变更次数：${result.change_count}`)
    }

    const text = lines.join('\n')

    try {
      await navigator.clipboard.writeText(text)
      const btn = document.getElementById(`copy-btn-${result.coupon_code}`)
      if (btn) {
        btn.textContent = '已复制'
        setTimeout(() => { btn.textContent = '复制' }, 1500)
      }
    } catch (error) {
      console.error('复制失败:', error)
      toast.error('复制失败')
    }
  }

  const handleQuery = async () => {
    const codes = couponCodes.split(/[\n,]/).map(c => c.trim()).filter(Boolean)
    if (!codes.length) {
      toast.warning('请输入券码')
      return
    }

    const requestId = ++couponResultsRequestIdRef.current
    couponResultsAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    couponResultsAbortControllerRef.current = abortController
    setQuerySummary(null)
    setLoading(true)
    setBackendLoading(false)
    setProgress({ current: 0, total: codes.length })
    setResults([])

    const allResults = []

    try {
      const dbResponse = await couponsApi.query({ coupon_codes: codes }, { signal: abortController.signal })
      const dbResults = dbResponse.data || []
      if (requestId !== couponResultsRequestIdRef.current) return

      for (let i = 0; i < dbResults.length; i++) {
        if (requestId !== couponResultsRequestIdRef.current) return
        const item = dbResults[i]
        setProgress({ current: i + 1, total: codes.length })

        if (item.status !== 'found' || !item.userid || !item.token) {
          const idStr = String(item.order_view_id || '')
          const isGiftId = idStr.length > 20 || /^[a-zA-Z]/.test(idStr)
          const displayOrderId = isGiftId ? '-' : (item.order_view_id || '-')
          const displayGiftId = isGiftId ? idStr : (item.gift_id || '-')

          allResults.push({
            coupon_code: item.coupon_code,
            current_coupon_code: item.current_coupon_code || item.coupon_code,
            order_view_id: displayOrderId,
            gift_id: displayGiftId,
            userid: item.userid || '-',
            coupon_status: item.coupon_status || '-',
            verify_time: '',
            verify_poi_name: '',
            status: item.status,
            account_id: item.account_id,
            order_db_id: item.order_id,
            is_old_code: item.is_old_code || false,
            code_changed: false,
            change_type: 'none',
            change_count: 0
          })
          continue
        }

        try {
          const idStr = String(item.order_view_id || '')
          const isGiftId = idStr.length > 20 || /^[a-zA-Z]/.test(idStr)
          const queryOrderId = isGiftId ? idStr : item.order_view_id

          const meituanResult = await window.electronAPI.rebateQueryOne({
            account: {
              userid: item.userid,
              token: item.token,
              csecuuid: item.csecuuid || '',
              openId: item.open_id || '',
              openIdCipher: item.open_id_cipher || '',
              platform: item.platform || 'android'
            },
            orderId: queryOrderId,
            isGiftId: isGiftId
          })
          if (requestId !== couponResultsRequestIdRef.current) return

          if (meituanResult.success && meituanResult.data?.response?.data) {
            const coupons = meituanResult.data.response.data
            const actualCode = item.current_coupon_code || item.coupon_code
            const matchedCoupon = coupons.find(c =>
              c.coupon === actualCode ||
              c.encode === actualCode ||
              c.coupon_code === actualCode ||
              c.coupon === item.coupon_code ||
              c.encode === item.coupon_code
            )

            if (matchedCoupon) {
              const verifyTime = matchedCoupon.verifyTime || ''
              const verifyPoiName = matchedCoupon.verifyPoiName || ''
              const displayOrderId = isGiftId ? '-' : (item.order_view_id || '-')
              const displayGiftId = isGiftId ? idStr : (item.gift_id || '-')

              allResults.push({
                coupon_code: item.coupon_code,
                current_coupon_code: item.current_coupon_code || matchedCoupon.coupon || item.coupon_code,
                order_view_id: displayOrderId,
                gift_id: displayGiftId,
                userid: item.userid || '-',
                coupon_status: matchedCoupon.order_status || matchedCoupon.coupon_status || '未知',
                use_status: matchedCoupon.useStatus,
                verify_time: verifyTime,
                verify_poi_name: verifyPoiName,
                status: 'success',
                account_id: item.account_id,
                order_db_id: item.order_id,
                is_old_code: item.is_old_code || false,
                code_changed: false,
                change_type: 'none',
                change_count: item.change_info?.change_count || 0
              })
            } else {
              try {
                const backendResponse = await couponsApi.queryBackend({ coupon_codes: [item.coupon_code] }, { signal: abortController.signal })
                const backendResult = backendResponse.data?.[0]
                if (backendResult && backendResult.status === 'found') {
                  allResults.push({
                    coupon_code: backendResult.coupon_code,
                    current_coupon_code: backendResult.current_coupon_code || backendResult.coupon_code,
                    order_view_id: backendResult.order_view_id || '-',
                    gift_id: backendResult.gift_id || '-',
                    userid: backendResult.userid || '-',
                    coupon_status: backendResult.coupon_status || '-',
                    verify_time: backendResult.verify_time || '',
                    verify_poi_name: backendResult.verify_poi_name || '',
                    status: 'backend',
                    account_id: item.account_id,
                    order_db_id: item.order_id,
                    is_old_code: backendResult.is_old_code || false,
                    code_changed: backendResult.code_changed || false,
                    change_type: backendResult.change_type || 'none',
                    old_coupon_code: backendResult.old_coupon_code,
                    change_count: backendResult.change_count || 0
                  })
                } else {
                  allResults.push({
                    coupon_code: item.coupon_code,
                    current_coupon_code: item.current_coupon_code || item.coupon_code,
                    order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                    gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                    userid: item.userid || '-',
                    coupon_status: item.coupon_status || '-',
                    verify_time: '',
                    verify_poi_name: '',
                    status: 'partial',
                    account_id: item.account_id,
                    order_db_id: item.order_id,
                    is_old_code: item.is_old_code || false,
                    code_changed: false,
                    change_type: 'none',
                    change_count: 0
                  })
                }
              } catch (backendError) {
                console.error('Backend query error:', backendError)
                allResults.push({
                  coupon_code: item.coupon_code,
                  current_coupon_code: item.current_coupon_code || item.coupon_code,
                  order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                  gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                  userid: item.userid || '-',
                  coupon_status: item.coupon_status || '-',
                  verify_time: '',
                  verify_poi_name: '',
                  status: 'partial',
                  account_id: item.account_id,
                  order_db_id: item.order_id,
                  is_old_code: item.is_old_code || false,
                  code_changed: false,
                  change_type: 'none',
                  change_count: 0
                })
              }
            }
          } else {
            try {
              const backendResponse = await couponsApi.queryBackend({ coupon_codes: [item.coupon_code] }, { signal: abortController.signal })
              const backendResult = backendResponse.data?.[0]
              if (backendResult && backendResult.status === 'found') {
                allResults.push({
                  coupon_code: backendResult.coupon_code,
                  current_coupon_code: backendResult.current_coupon_code || backendResult.coupon_code,
                  order_view_id: backendResult.order_view_id || '-',
                  gift_id: backendResult.gift_id || '-',
                  userid: backendResult.userid || '-',
                  coupon_status: backendResult.coupon_status || '-',
                  verify_time: backendResult.verify_time || '',
                  verify_poi_name: backendResult.verify_poi_name || '',
                  status: 'backend',
                  account_id: item.account_id,
                  order_db_id: item.order_id,
                  is_old_code: backendResult.is_old_code || false,
                  code_changed: backendResult.code_changed || false,
                  change_type: backendResult.change_type || 'none',
                  old_coupon_code: backendResult.old_coupon_code,
                  change_count: backendResult.change_count || 0
                })
              } else {
                allResults.push({
                  coupon_code: item.coupon_code,
                  current_coupon_code: item.current_coupon_code || item.coupon_code,
                  order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                  gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                  userid: item.userid || '-',
                  coupon_status: item.coupon_status || '-',
                  verify_time: '',
                  verify_poi_name: '',
                  status: 'error',
                  account_id: item.account_id,
                  order_db_id: item.order_id,
                  is_old_code: item.is_old_code || false,
                  code_changed: false,
                  change_type: 'none',
                  change_count: 0
                })
              }
            } catch (backendError) {
              console.error('Backend query error:', backendError)
              allResults.push({
                coupon_code: item.coupon_code,
                current_coupon_code: item.current_coupon_code || item.coupon_code,
                order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                userid: item.userid || '-',
                coupon_status: item.coupon_status || '-',
                verify_time: '',
                verify_poi_name: '',
                status: 'error',
                account_id: item.account_id,
                order_db_id: item.order_id,
                is_old_code: item.is_old_code || false,
                code_changed: false,
                change_type: 'none',
                change_count: 0
              })
            }
          }
        } catch (error) {
          console.error('Query meituan error:', error)
          try {
            const backendResponse = await couponsApi.queryBackend({ coupon_codes: [item.coupon_code] }, { signal: abortController.signal })
            const backendResult = backendResponse.data?.[0]
            if (backendResult && backendResult.status === 'found') {
              allResults.push({
                coupon_code: backendResult.coupon_code,
                current_coupon_code: backendResult.current_coupon_code || backendResult.coupon_code,
                order_view_id: backendResult.order_view_id || '-',
                gift_id: backendResult.gift_id || '-',
                userid: backendResult.userid || '-',
                coupon_status: backendResult.coupon_status || '-',
                verify_time: backendResult.verify_time || '',
                verify_poi_name: backendResult.verify_poi_name || '',
                status: 'backend',
                account_id: item.account_id,
                order_db_id: item.order_id,
                is_old_code: backendResult.is_old_code || false,
                code_changed: backendResult.code_changed || false,
                change_type: backendResult.change_type || 'none',
                old_coupon_code: backendResult.old_coupon_code,
                change_count: backendResult.change_count || 0
              })
            } else {
              allResults.push({
                coupon_code: item.coupon_code,
                current_coupon_code: item.current_coupon_code || item.coupon_code,
                order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
                gift_id: isGiftId ? idStr : (item.gift_id || '-'),
                userid: item.userid || '-',
                coupon_status: item.coupon_status || '-',
                verify_time: '',
                verify_poi_name: '',
                status: 'error',
                account_id: item.account_id,
                order_db_id: item.order_id,
                is_old_code: item.is_old_code || false,
                code_changed: false,
                change_type: 'none',
                change_count: 0
              })
            }
          } catch (backendError) {
            console.error('Backend query error:', backendError)
            allResults.push({
              coupon_code: item.coupon_code,
              current_coupon_code: item.current_coupon_code || item.coupon_code,
              order_view_id: isGiftId ? '-' : (item.order_view_id || '-'),
              gift_id: isGiftId ? idStr : (item.gift_id || '-'),
              userid: item.userid || '-',
              coupon_status: item.coupon_status || '-',
              verify_time: '',
              verify_poi_name: '',
              status: 'error',
              account_id: item.account_id,
              order_db_id: item.order_id,
              is_old_code: item.is_old_code || false,
              code_changed: false,
              change_type: 'none',
              change_count: 0
            })
          }
        }

        if (i < dbResults.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }

      if (requestId !== couponResultsRequestIdRef.current) return
      if (requestId !== couponResultsRequestIdRef.current) return
      setResults(allResults)
      setQuerySummary(createSuccessQueryResult({
        source: 'frontend',
        coupons: allResults,
        message: `查询完成，返回 ${allResults.length} 条结果`,
        meta: {
          inputCount: codes.length
        }
      }))

      const successResults = allResults.filter(r =>
        r.status === 'success' &&
        r.coupon_status &&
        (r.current_coupon_code || r.coupon_code)
      )

      if (successResults.length > 0) {
        try {
          await couponsApi.batchUpdate({
            coupons: successResults.map(r => ({
              coupon_code: r.current_coupon_code || r.coupon_code,
              coupon_status: r.coupon_status,
              use_status: r.use_status
            }))
          }, { signal: abortController.signal })
          console.log(`批量更新了 ${successResults.length} 条券码状态`)
        } catch (updateError) {
          console.error('批量更新券码状态失败:', updateError)
        }
      }
    } catch (error) {
      if (isAbortError(error)) return
      if (requestId !== couponResultsRequestIdRef.current) return
      console.error('Query failed:', error)
      setQuerySummary(createErrorQueryResult({
        source: 'frontend',
        message: `查询失败: ${getErrorMessage(error, '未知错误')}`,
        meta: {
          inputCount: codes.length
        }
      }))
      toast.error('查询失败: ' + getErrorMessage(error, '未知错误'))
    } finally {
      if (couponResultsAbortControllerRef.current === abortController) {
        couponResultsAbortControllerRef.current = null
      }
      if (requestId === couponResultsRequestIdRef.current) {
        setLoading(false)
      }
    }
  }

  const handleBackendQuery = async () => {
    const codes = couponCodes.split(/[\n,]/).map(c => c.trim()).filter(Boolean)
    if (!codes.length) {
      toast.warning('请输入券码')
      return
    }

    const requestId = ++couponResultsRequestIdRef.current
    couponResultsAbortControllerRef.current?.abort()
    const abortController = new AbortController()
    couponResultsAbortControllerRef.current = abortController
    setQuerySummary(null)
    setBackendLoading(true)
    setLoading(false)
    setResults([])

    try {
      const response = await couponsApi.queryBackend({ coupon_codes: codes }, { signal: abortController.signal })
      const backendResults = response.data || []

      const allResults = backendResults.map(item => ({
        coupon_code: item.coupon_code,
        current_coupon_code: item.current_coupon_code || item.coupon_code,
        order_view_id: item.order_view_id || '-',
        gift_id: item.gift_id || '-',
        userid: item.userid || '-',
        coupon_status: item.coupon_status || '-',
        verify_time: item.verify_time || '',
        verify_poi_name: item.verify_poi_name || '',
        status: item.status,
        is_old_code: item.is_old_code || false,
        code_changed: item.code_changed || false,
        change_type: item.change_type || 'none',
        old_coupon_code: item.old_coupon_code,
        change_count: item.change_count || 0
      }))

      if (requestId !== couponResultsRequestIdRef.current) return
      setResults(allResults)
      setQuerySummary(createSuccessQueryResult({
        source: 'backend',
        coupons: allResults,
        message: `后端查询完成，返回 ${allResults.length} 条结果`,
        meta: {
          inputCount: codes.length
        }
      }))
    } catch (error) {
      if (isAbortError(error)) return
      if (requestId !== couponResultsRequestIdRef.current) return
      console.error('Backend query failed:', error)
      setQuerySummary(createErrorQueryResult({
        source: 'backend',
        message: `后端查询失败: ${getErrorMessage(error, '未知错误')}`,
        meta: {
          inputCount: codes.length
        }
      }))
      toast.error('后端查询失败: ' + getErrorMessage(error, '未知错误'))
    } finally {
      if (couponResultsAbortControllerRef.current === abortController) {
        couponResultsAbortControllerRef.current = null
      }
      if (requestId === couponResultsRequestIdRef.current) {
        setBackendLoading(false)
      }
    }
  }

  const handleExport = async () => {
    const headers = ['券码', '当前券码', '订单号', '礼物号', 'USERID', '券码状态', '核销时间', '核销门店', '状态', '变更状态', '旧券码', '变更次数']
    const rows = normalizedResults.map(row => [
      row.couponCode,
      row.currentCouponCode,
      row.displayOrderId === '-' ? '' : row.displayOrderId,
      row.displayGiftId === '-' ? '' : row.displayGiftId,
      row.userId === '-' ? '' : row.userId,
      row.couponStatus === '-' ? '' : row.couponStatus,
      row.verifyTime === '-' ? '' : row.verifyTime,
      row.verifyPoiName === '-' ? '' : row.verifyPoiName,
      getStatusText(row.queryStatus),
      row.isOldCode ? '旧券码' : getChangeTypeText(row.changeType),
      row.oldCouponCode,
      row.changeCount
    ])

    try {
      await window.electronAPI.exportExcel({
        data: rows,
        filename: `券码查询结果_${new Date().toISOString().split('T')[0]}.xlsx`,
        headers
      })
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  const handleClear = () => {
    couponResultsRequestIdRef.current += 1
    couponResultsAbortControllerRef.current?.abort()
    couponResultsAbortControllerRef.current = null
    setCouponCodes('')
    setResults([])
    setQuerySummary(null)
    setLoading(false)
    setBackendLoading(false)
    setProgress({ current: 0, total: 0 })
    clearCouponQueryData()
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
      case 'found':
      case 'backend':
        return 'bg-green-100 text-green-800'
      case 'not_found': return 'bg-gray-100 text-gray-800'
      case 'partial': return 'bg-yellow-100 text-yellow-800'
      case 'error': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusText = (status) => {
    switch (status) {
      case 'success':
      case 'found':
        return '成功'
      case 'backend': return '成功'
      case 'not_found': return '未找到'
      case 'partial': return '部分成功'
      case 'error': return '错误'
      default: return status
    }
  }

  const getChangeTypeColor = (changeType, isOldCode) => {
    if (isOldCode) {
      return 'bg-blue-100 text-blue-800'
    }
    switch (changeType) {
      case 'full': return 'bg-red-100 text-red-800'
      case 'partial': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  const getChangeTypeText = (changeType) => {
    switch (changeType) {
      case 'full': return '全部变更'
      case 'partial': return '部分变更'
      default: return '-'
    }
  }

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-'
    try {
      return new Date(dateStr).toLocaleString('zh-CN')
    } catch {
      return dateStr
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
      {/* 工具栏 */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex gap-2">
            <button
              onClick={handleClear}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> 清空
            </button>
            <button
              onClick={handleQuery}
              disabled={loading || backendLoading}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  查询中 {progress.current}/{progress.total}
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" /> 查询
                </>
              )}
            </button>
            <button
              onClick={handleBackendQuery}
              disabled={loading || backendLoading}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2 disabled:opacity-50"
            >
              {backendLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  查询中...
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" /> 后端查询
                </>
              )}
            </button>
            <button
              onClick={handleExport}
              disabled={!results.length}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> 导出Excel
            </button>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-gray-500 mb-1">
            输入券码（每行一个或逗号分隔）
          </label>
          <textarea
            value={couponCodes}
            onChange={(e) => setCouponCodes(e.target.value)}
            rows={6}
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
            placeholder="请输入券码，每行一个&#10;例如：&#10;027356222860&#10;026825522544"
          />
        </div>
      </div>

      {/* 结果表格 */}
      {querySummary && (
        <div className="bg-white rounded-xl shadow-sm px-4 py-3 mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
              querySummary.status === QUERY_RESULT_STATUS.SUCCESS
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}>
              {querySummary.status === QUERY_RESULT_STATUS.SUCCESS ? '成功' : '失败'}
            </span>
            <span className="text-sm text-gray-700">{querySummary.message}</span>
            <span className="text-xs text-blue-500">({querySummary.sourceLabel})</span>
            {querySummary.status === QUERY_RESULT_STATUS.SUCCESS && (
              <span className="text-xs text-gray-500">共 {querySummary.count} 条</span>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">券码</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">礼物号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">USERID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">券码状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">核销时间</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">核销门店</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">查询状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">变更状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {results.map((result, index) => (
                <tr key={index} className={`hover:bg-gray-50 ${result.is_old_code ? 'bg-blue-50' : ''}`}>
                  <td className="px-4 py-3 text-sm text-gray-900 font-mono">
                    <div className="flex items-center gap-2">
                      <span>{result.coupon_code}</span>
                      {result.is_old_code && (
                        <span className="text-xs text-blue-600 flex items-center gap-1">
                          <ArrowRight className="w-3 h-3" />
                          {result.current_coupon_code}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">{result.order_view_id || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{result.gift_id || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">{result.userid || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      result.coupon_status === '待使用' ? 'bg-blue-100 text-blue-800' :
                      result.coupon_status === '已使用' ? 'bg-gray-100 text-gray-600' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {result.coupon_status || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{result.verify_time || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-[150px] truncate" title={result.verify_poi_name}>{result.verify_poi_name || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(result.status)}`}>
                      {getStatusText(result.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getChangeTypeColor(result.change_type, result.is_old_code)}`}>
                        {result.is_old_code ? '旧券码' : getChangeTypeText(result.change_type)}
                      </span>
                      {result.code_changed && result.old_coupon_code && (
                        <span className="text-xs text-gray-500" title="原券码">
                          原: {result.old_coupon_code}
                        </span>
                      )}
                      {result.change_count > 0 && (
                        <span className="text-xs text-gray-400">
                          变更{result.change_count}次
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleShowDetail(result)}
                        className="px-2 py-1 text-xs bg-purple-50 text-purple-600 rounded hover:bg-purple-100"
                        title="查看详情"
                      >
                        详情
                      </button>
                      <button
                        id={`copy-btn-${result.coupon_code}`}
                        onClick={() => handleCopy(result)}
                        className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                      >
                        复制
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {results.length === 0 && !loading && (
                <tr>
                  <td colSpan="10" className="px-4 py-8 text-center text-gray-500">
                    暂无查询结果，请输入券码并点击查询
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CouponQueryResultDialog
        open={couponDialogOpen}
        onClose={handleCloseDetail}
        titleSuffix={couponDialogTitle}
        queryResult={couponDialogResult}
        queryMeta={couponDialogMeta}
        loading={couponDialogLoading}
        onRefresh={couponDialogRefreshFn || undefined}
      />
    </div>
  )
}

export default CouponQueryPage
