package expo.modules.photometa

import android.app.Activity
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.MediaStore
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts.StartIntentSenderForResult.Companion.ACTION_INTENT_SENDER_REQUEST
import androidx.activity.result.contract.ActivityResultContracts.StartIntentSenderForResult.Companion.EXTRA_INTENT_SENDER_REQUEST
import androidx.annotation.RequiresApi
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.providers.AppContextProvider
import java.io.Serializable

// 사진을 기기 휴지통으로 옮기는 시스템 확인 창 (Android 11+). 사용자가 허용하면 시스템이 바로 옮긴다.
class TrashContract(
  private val appContextProvider: AppContextProvider
) : AppContextActivityResultContract<TrashContractInput, Boolean> {
  @RequiresApi(Build.VERSION_CODES.R)
  override fun createIntent(context: Context, input: TrashContractInput): Intent {
    val contentResolver = appContextProvider.appContext.reactContext?.contentResolver
      ?: throw Exceptions.ReactContextLost()
    val uris = input.assetIds.map {
      ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, it.toLong())
    }
    val request = MediaStore.createTrashRequest(contentResolver, uris, true)
    val intentSenderRequest = IntentSenderRequest.Builder(request.intentSender).build()
    return Intent(ACTION_INTENT_SENDER_REQUEST).putExtra(EXTRA_INTENT_SENDER_REQUEST, intentSenderRequest)
  }

  override fun parseResult(input: TrashContractInput, resultCode: Int, intent: Intent?): Boolean {
    return resultCode == Activity.RESULT_OK
  }
}

data class TrashContractInput(val assetIds: List<String>) : Serializable
