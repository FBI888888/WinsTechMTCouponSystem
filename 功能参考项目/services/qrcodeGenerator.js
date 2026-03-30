/**
 * 券码图片生成模块
 * 返回组件数据供前端渲染（不依赖native canvas模块）
 */
const bwipjs = require('bwip-js')
const QRCode = require('qrcode')

// 模板图片URL
const TEMPLATE_URL = 'https://test-wins.oss-cn-hangzhou.aliyuncs.com/mt%E6%A0%B7%E5%9B%BE.jpg'

// 组件位置配置（与原Python项目一致）
const COMPONENT_POSITIONS = {
  title: { x: 0, y: 319, width: 1440, height: 90 },
  date: { x: 650, y: 416, width: 350, height: 52 },
  code: { x: 120, y: 680, width: 550, height: 90 },
  qrcode: { x: 406, y: 868, width: 490, height: 490 },
  barcode: { x: 949, y: 868, width: 100, height: 490 },
  notes: { x: 10, y: 3000, width: 600, height: 70 }
}

class QrcodeGenerator {
  /**
   * 格式化券码（每4位加空格）
   */
  static formatVoucherCode(code) {
    if (!code) return ''
    const clean = String(code).replace(/\s/g, '')
    
    if (clean.length === 12) {
      return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ${clean.slice(8, 12)}`
    } else if (clean.length === 11) {
      return `${clean.slice(0, 4)} ${clean.slice(4, 7)} ${clean.slice(7, 11)}`
    } else if (clean.length >= 8) {
      return clean.match(/.{1,4}/g)?.join(' ') || clean
    }
    return clean
  }

  /**
   * 生成条形码Base64（竖向）
   */
  static async generateBarcodeBase64(text) {
    try {
      const png = await bwipjs.toBuffer({
        bcid: 'code128',
        text: String(text),
        scale: 3,
        height: 30,
        includetext: false,
        rotate: 'L'  // 向左旋转90度
      })
      return `data:image/png;base64,${png.toString('base64')}`
    } catch (error) {
      console.error('生成条形码失败:', error)
      return null
    }
  }

  /**
   * 生成二维码Base64
   */
  static async generateQRCodeBase64(text) {
    try {
      const dataUrl = await QRCode.toDataURL(String(text), {
        width: 490,
        margin: 0,
        color: { dark: '#000000', light: '#ffffff' }
      })
      return dataUrl
    } catch (error) {
      console.error('生成二维码失败:', error)
      return null
    }
  }

  /**
   * 生成券码图片数据
   * 返回所有组件数据供前端Canvas渲染
   */
  static async generateCouponImage(title, couponCode, notes = '', dateText = null) {
    try {
      const formattedCode = this.formatVoucherCode(couponCode)
      
      // 生成默认日期
      if (!dateText) {
        const now = new Date()
        dateText = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} 23:59`
      }
      
      // 生成二维码和条形码
      const qrcodeBase64 = await this.generateQRCodeBase64(couponCode)
      const barcodeBase64 = await this.generateBarcodeBase64(couponCode)
      
      console.log('券码组件生成成功')
      
      return {
        success: true,
        // 使用前端渲染
        renderInFrontend: true,
        templateUrl: TEMPLATE_URL,
        positions: COMPONENT_POSITIONS,
        // 组件数据
        title: title || '团购券',
        couponCode,
        formattedCode,
        notes: notes || '',
        dateText,
        qrcodeBase64,
        barcodeBase64
      }
    } catch (error) {
      console.error('生成券码组件失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }
}

module.exports = QrcodeGenerator
