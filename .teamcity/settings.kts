import jetbrains.buildServer.configs.kotlin.*
import jetbrains.buildServer.configs.kotlin.buildFeatures.sshAgent
import jetbrains.buildServer.configs.kotlin.buildSteps.script
import jetbrains.buildServer.configs.kotlin.triggers.vcs
import jetbrains.buildServer.configs.kotlin.vcs.GitVcsRoot

version = "2025.11"

project {
    vcsRoot(HermesSource)
    buildType(Release)
}

object HermesSource : GitVcsRoot({
    id("HermesSource")
    name = "Hermes_flotter main"
    url = "https://github.com/NemodaMark/Hermes_flotter.git"
    branch = "refs/heads/main"
})

object Release : BuildType({
    id("HermesRelease")
    name = "HERMES — ellenőrzés és telepítés"
    maxRunningBuilds = 1
    enablePersonalBuilds = false
    vcs {
        root(HermesSource)
        checkoutMode = CheckoutMode.ON_AGENT
    }
    params {
        param("env.HERMES_DEPLOY_HOST", "")
    }
    requirements {
        equals("teamcity.agent.jvm.os.name", "Linux")
    }
    features {
        sshAgent { teamcitySshKey = "hermes-deploy" }
    }
    steps {
        script {
            name = "Tesztek és build"
            scriptContent = "bash deploy/teamcity/verify.sh"
        }
        script {
            name = "Ellenőrzött commit telepítése"
            scriptContent = "bash deploy/teamcity/release.sh %build.vcs.number%"
        }
    }
    triggers { vcs { branchFilter = "+:<default>" } }
})
